use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use chrono::Utc;
use napi::bindgen_prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// Active conversation that owns subsequent filesystem mutations.
static ACTIVE_CHECKPOINT: OnceLock<Mutex<Option<ActiveCheckpoint>>> = OnceLock::new();

fn active_lock() -> &'static Mutex<Option<ActiveCheckpoint>> {
    ACTIVE_CHECKPOINT.get_or_init(|| Mutex::new(None))
}

#[derive(Clone, Debug)]
struct ActiveCheckpoint {
    conversation_id: String,
    message_id: String,
    dir: PathBuf,
    /// Absolute path -> relative snapshot path (or empty for "did not exist")
    tracked: HashMap<String, String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct CheckpointManifest {
    conversation_id: String,
    message_id: String,
    created_at: String,
    /// Absolute original path -> relative snapshot path under checkpoint dir.
    /// Empty string means the file did not exist before mutation (created).
    files: HashMap<String, String>,
}

fn checkpoints_root() -> Result<PathBuf> {
    let storage_info = crate::storage::initialize_app_storage()?;
    let root = PathBuf::from(storage_info.directory_path).join("checkpoints");
    fs::create_dir_all(&root).map_err(|error| {
        Error::from_reason(format!(
            "Failed to create checkpoints directory at '{}': {error}",
            root.display()
        ))
    })?;
    Ok(root)
}

fn checkpoint_dir(conversation_id: &str, message_id: &str) -> Result<PathBuf> {
    let root = checkpoints_root()?;
    let safe_conv = sanitize_id(conversation_id);
    let safe_msg = sanitize_id(message_id);
    let dir = root.join(safe_conv).join(safe_msg);
    fs::create_dir_all(&dir).map_err(|error| {
        Error::from_reason(format!(
            "Failed to create checkpoint directory at '{}': {error}",
            dir.display()
        ))
    })?;
    Ok(dir)
}

fn sanitize_id(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

fn hash_path(path: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn write_manifest(dir: &Path, manifest: &CheckpointManifest) -> Result<()> {
    let path = dir.join("manifest.json");
    let content = serde_json::to_string_pretty(manifest).map_err(|error| {
        Error::from_reason(format!("Failed to serialize checkpoint manifest: {error}"))
    })?;
    fs::write(&path, content).map_err(|error| {
        Error::from_reason(format!(
            "Failed to write checkpoint manifest at '{}': {error}",
            path.display()
        ))
    })?;
    Ok(())
}

fn read_manifest(dir: &Path) -> Result<CheckpointManifest> {
    let path = dir.join("manifest.json");
    let content = fs::read_to_string(&path).map_err(|error| {
        Error::from_reason(format!(
            "Failed to read checkpoint manifest at '{}': {error}",
            path.display()
        ))
    })?;
    serde_json::from_str(&content).map_err(|error| {
        Error::from_reason(format!("Failed to parse checkpoint manifest: {error}"))
    })
}

/// Start a new checkpoint for a user message. Subsequent filesystem mutations
/// will snapshot original content under this checkpoint.
pub fn begin_checkpoint(conversation_id: String, message_id: String) -> Result<()> {
    let trimmed_conv = conversation_id.trim();
    let trimmed_msg = message_id.trim();
    if trimmed_conv.is_empty() || trimmed_msg.is_empty() {
        return Err(Error::from_reason(
            "conversation_id and message_id are required".to_string(),
        ));
    }

    let dir = checkpoint_dir(trimmed_conv, trimmed_msg)?;
    let manifest = CheckpointManifest {
        conversation_id: trimmed_conv.to_string(),
        message_id: trimmed_msg.to_string(),
        created_at: Utc::now().to_rfc3339(),
        files: HashMap::new(),
    };
    write_manifest(&dir, &manifest)?;

    let mut guard = active_lock()
        .lock()
        .map_err(|_| Error::from_reason("Failed to lock checkpoint state".to_string()))?;
    *guard = Some(ActiveCheckpoint {
        conversation_id: trimmed_conv.to_string(),
        message_id: trimmed_msg.to_string(),
        dir,
        tracked: HashMap::new(),
    });
    Ok(())
}

/// Snapshot a file before mutation if an active checkpoint exists.
/// Safe to call even when no checkpoint is active.
pub fn snapshot_before_write(file_path: &str) {
    let path = Path::new(file_path);
    let absolute = match path.canonicalize() {
        Ok(p) => p.to_string_lossy().into_owned(),
        Err(_) => {
            // File may not exist yet; keep a stable absolute-ish path as key.
            if path.is_absolute() {
                file_path.to_string()
            } else {
                match std::env::current_dir() {
                    Ok(cwd) => cwd.join(path).to_string_lossy().into_owned(),
                    Err(_) => file_path.to_string(),
                }
            }
        }
    };

    let mut guard = match active_lock().lock() {
        Ok(g) => g,
        Err(_) => return,
    };
    let Some(active) = guard.as_mut() else {
        return;
    };

    if active.tracked.contains_key(&absolute) {
        return;
    }

    let snapshot_name = hash_path(&absolute);
    let source = Path::new(&absolute);
    let snapshot_rel = if source.exists() && source.is_file() {
        let dest = active.dir.join(&snapshot_name);
        match fs::copy(source, &dest) {
            Ok(_) => snapshot_name,
            Err(_) => String::new(),
        }
    } else {
        // File did not exist -> created by this mutation.
        String::new()
    };

    active
        .tracked
        .insert(absolute.clone(), snapshot_rel.clone());

    // Persist updated manifest.
    let manifest = CheckpointManifest {
        conversation_id: active.conversation_id.clone(),
        message_id: active.message_id.clone(),
        created_at: Utc::now().to_rfc3339(),
        files: active.tracked.clone(),
    };
    let _ = write_manifest(&active.dir, &manifest);
}

/// Restore all files from a checkpoint, then remove later checkpoints for the conversation.
pub fn restore_checkpoint(conversation_id: String, message_id: String) -> Result<Value> {
    let trimmed_conv = conversation_id.trim();
    let trimmed_msg = message_id.trim();
    if trimmed_conv.is_empty() || trimmed_msg.is_empty() {
        return Err(Error::from_reason(
            "conversation_id and message_id are required".to_string(),
        ));
    }

    let dir = checkpoint_dir(trimmed_conv, trimmed_msg)?;
    let manifest = read_manifest(&dir)?;

    let mut restored = 0usize;
    let mut deleted = 0usize;
    let mut errors: Vec<String> = Vec::new();

    for (original_path, snapshot_rel) in &manifest.files {
        if snapshot_rel.is_empty() {
            // File was created after checkpoint — delete it.
            let path = Path::new(original_path);
            if path.exists() {
                match fs::remove_file(path) {
                    Ok(()) => deleted += 1,
                    Err(error) => {
                        errors.push(format!("Failed to delete '{original_path}': {error}"));
                    }
                }
            }
        } else {
            let snapshot_path = dir.join(snapshot_rel);
            let dest = Path::new(original_path);
            if let Some(parent) = dest.parent() {
                if !parent.exists() {
                    if let Err(error) = fs::create_dir_all(parent) {
                        errors.push(format!(
                            "Failed to create parent for '{original_path}': {error}"
                        ));
                        continue;
                    }
                }
            }
            match fs::copy(&snapshot_path, dest) {
                Ok(_) => restored += 1,
                Err(error) => {
                    errors.push(format!(
                        "Failed to restore '{original_path}' from '{}': {error}",
                        snapshot_path.display()
                    ));
                }
            }
        }
    }

    // Remove this and all later checkpoints for the conversation.
    remove_checkpoints_from(trimmed_conv, trimmed_msg)?;

    // Clear active if it matches.
    if let Ok(mut guard) = active_lock().lock() {
        if let Some(active) = guard.as_ref() {
            if active.conversation_id == trimmed_conv {
                *guard = None;
            }
        }
    }

    Ok(json!({
        "success": errors.is_empty(),
        "restored": restored,
        "deleted": deleted,
        "errors": errors
    }))
}

fn remove_checkpoints_from(conversation_id: &str, from_message_id: &str) -> Result<()> {
    let root = checkpoints_root()?;
    let conv_dir = root.join(sanitize_id(conversation_id));
    if !conv_dir.exists() {
        return Ok(());
    }

    // Collect all checkpoint dirs with their created_at.
    let mut entries: Vec<(String, String, PathBuf)> = Vec::new();
    let read_dir = fs::read_dir(&conv_dir).map_err(|error| {
        Error::from_reason(format!(
            "Failed to read checkpoint conversation dir '{}': {error}",
            conv_dir.display()
        ))
    })?;

    for entry in read_dir.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if let Ok(manifest) = read_manifest(&path) {
            entries.push((manifest.message_id, manifest.created_at, path));
        }
    }

    let from_created = entries
        .iter()
        .find(|(msg, _, _)| msg == from_message_id)
        .map(|(_, created, _)| created.clone());

    let Some(threshold) = from_created else {
        // Message checkpoint not found; still try to remove the specific dir.
        let specific = conv_dir.join(sanitize_id(from_message_id));
        if specific.exists() {
            let _ = fs::remove_dir_all(&specific);
        }
        return Ok(());
    };

    for (msg_id, created_at, path) in entries {
        if created_at >= threshold || msg_id == from_message_id {
            let _ = fs::remove_dir_all(&path);
        }
    }

    // Clean empty conversation folder.
    if let Ok(mut remaining) = fs::read_dir(&conv_dir) {
        if remaining.next().is_none() {
            let _ = fs::remove_dir(&conv_dir);
        }
    }

    Ok(())
}

/// Rename active / on-disk checkpoint when a pending conversation gets a real id.
pub fn migrate_checkpoint(old_conversation_id: String, new_conversation_id: String) -> Result<()> {
    let old_id = old_conversation_id.trim();
    let new_id = new_conversation_id.trim();
    if old_id.is_empty() || new_id.is_empty() || old_id == new_id {
        return Ok(());
    }

    let root = checkpoints_root()?;
    let old_dir = root.join(sanitize_id(old_id));
    let new_dir = root.join(sanitize_id(new_id));

    if old_dir.exists() {
        if new_dir.exists() {
            // Merge: move each checkpoint subdir if missing on destination.
            if let Ok(entries) = fs::read_dir(&old_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_dir() {
                        let dest = new_dir.join(entry.file_name());
                        if !dest.exists() {
                            let _ = fs::rename(&path, &dest);
                        }
                    }
                }
            }
            let _ = fs::remove_dir_all(&old_dir);
        } else {
            if let Some(parent) = new_dir.parent() {
                let _ = fs::create_dir_all(parent);
            }
            fs::rename(&old_dir, &new_dir).map_err(|error| {
                Error::from_reason(format!(
                    "Failed to migrate checkpoint directory from '{}' to '{}': {error}",
                    old_dir.display(),
                    new_dir.display()
                ))
            })?;
        }
    }

    if let Ok(mut guard) = active_lock().lock() {
        if let Some(active) = guard.as_mut() {
            if active.conversation_id == old_id {
                active.conversation_id = new_id.to_string();
                // Rebind dir to the migrated message checkpoint if present.
                let msg_dir = new_dir.join(sanitize_id(&active.message_id));
                if msg_dir.exists() {
                    active.dir = msg_dir;
                } else {
                    active.dir = checkpoint_dir(new_id, &active.message_id)?;
                }
            }
        }
    }

    Ok(())
}

/// Remove all checkpoints for a conversation (e.g. when conversation is deleted).
#[allow(dead_code)]
pub fn clear_conversation_checkpoints(conversation_id: String) -> Result<()> {
    let root = checkpoints_root()?;
    let conv_dir = root.join(sanitize_id(conversation_id.trim()));
    if conv_dir.exists() {
        fs::remove_dir_all(&conv_dir).map_err(|error| {
            Error::from_reason(format!(
                "Failed to clear checkpoints for conversation: {error}"
            ))
        })?;
    }
    if let Ok(mut guard) = active_lock().lock() {
        if let Some(active) = guard.as_ref() {
            if active.conversation_id == conversation_id.trim() {
                *guard = None;
            }
        }
    }
    Ok(())
}
