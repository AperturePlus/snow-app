use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use napi::bindgen_prelude::*;
use napi_derive::napi;
use serde::{Deserialize, Serialize};

const CHECKPOINT_DIR_NAME: &str = "checkpoints";
const MAX_DEPTH: usize = 32;

/// Directories that are always excluded from checkpoint snapshots.
/// These are typically large, generated, or version-control related
/// directories that should not be copied or restored.
const SKIP_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    ".svn",
    ".hg",
    "dist",
    "build",
    ".next",
    ".nuxt",
    "out",
    "coverage",
    ".cache",
    ".turbo",
    ".vercel",
    "target",
    "__pycache__",
    ".venv",
    "venv",
    ".idea",
    ".vscode",
    ".snow",
    ".snowapp",
    "release",
    ".output",
    ".angular",
    ".parcel-cache",
];

static COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Serialize, Deserialize)]
struct CheckpointManifest {
    work_dir: String,
    files: Vec<String>,
}

fn checkpoint_root() -> Result<PathBuf> {
    let storage_dir = crate::storage::paths::app_storage_dir()?;
    Ok(storage_dir.join(CHECKPOINT_DIR_NAME))
}

fn should_skip_dir(name: &str) -> bool {
    SKIP_DIRS.contains(&name)
}

fn generate_checkpoint_id() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let count = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("cp-{}-{}-{}", now.as_secs(), now.subsec_nanos(), count)
}

/// Normalize a relative path to use forward slashes for cross-platform
/// manifest consistency.
fn to_forward_slashes(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

/// Convert a forward-slash relative path back to an OS-native PathBuf.
fn from_forward_slashes(relative: &str) -> PathBuf {
    PathBuf::from(relative.replace(
        '/',
        &std::path::MAIN_SEPARATOR.to_string(),
    ))
}

/// Create a file-system checkpoint (snapshot) of the working directory.
///
/// Walks `work_dir` recursively (excluding large/generated directories),
/// copies every file into `<app-storage>/checkpoints/<id>/files/`, and
/// writes a `manifest.json` recording all captured relative paths.
///
/// Returns the generated checkpoint id.
pub fn create_checkpoint(work_dir: String) -> Result<String> {
    let root = Path::new(&work_dir);
    if !root.exists() {
        return Err(Error::from_reason(format!(
            "Working directory does not exist: {}",
            work_dir
        )));
    }
    if !root.is_dir() {
        return Err(Error::from_reason(format!(
            "Path is not a directory: {}",
            work_dir
        )));
    }

    let checkpoint_id = generate_checkpoint_id();
    let checkpoint_dir = checkpoint_root()?.join(&checkpoint_id);
    let files_dir = checkpoint_dir.join("files");

    fs::create_dir_all(&files_dir).map_err(|e| {
        Error::from_reason(format!(
            "Failed to create checkpoint directory at '{}': {}",
            checkpoint_dir.display(),
            e
        ))
    })?;

    let mut manifest = CheckpointManifest {
        work_dir: work_dir.clone(),
        files: Vec::new(),
    };

    collect_files(root, root, &files_dir, &mut manifest, 0)?;

    let manifest_path = checkpoint_dir.join("manifest.json");
    let manifest_json =
        serde_json::to_string(&manifest).map_err(|e| {
            Error::from_reason(format!("Failed to serialize checkpoint manifest: {}", e))
        })?;
    fs::write(&manifest_path, manifest_json).map_err(|e| {
        Error::from_reason(format!("Failed to write checkpoint manifest: {}", e))
    })?;

    Ok(checkpoint_id)
}

fn collect_files(
    root: &Path,
    current: &Path,
    files_dir: &Path,
    manifest: &mut CheckpointManifest,
    depth: usize,
) -> Result<()> {
    if depth > MAX_DEPTH {
        return Ok(());
    }

    let entries = match fs::read_dir(current) {
        Ok(e) => e,
        Err(_) => return Ok(()),
    };

    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        let name = entry.file_name().to_string_lossy().to_string();

        let file_type = match entry.file_type() {
            Ok(t) => t,
            Err(_) => continue,
        };

        // Skip symlinks to avoid cycles and copying linked content.
        if file_type.is_symlink() {
            continue;
        }

        let full_path = entry.path();

        if file_type.is_dir() {
            if should_skip_dir(&name) {
                continue;
            }
            collect_files(root, &full_path, files_dir, manifest, depth + 1)?;
        } else if file_type.is_file() {
            let relative = match full_path.strip_prefix(root) {
                Ok(rel) => rel,
                Err(_) => continue,
            };
            let rel_str = to_forward_slashes(relative);
            let dest = files_dir.join(relative);
            if let Some(parent) = dest.parent() {
                let _ = fs::create_dir_all(parent);
            }
            // Best-effort copy; skip files that cannot be read.
            if fs::copy(&full_path, &dest).is_ok() {
                manifest.files.push(rel_str);
            }
        }
    }

    Ok(())
}

/// Restore the working directory to the state captured by a checkpoint.
///
/// 1. Deletes files in `work_dir` that did not exist at checkpoint time
///    (i.e. newly created by the AI loop).
/// 2. Overwrites/restores every file recorded in the checkpoint manifest,
///    reverting modifications and re-creating deleted files.
pub fn restore_checkpoint(checkpoint_id: String, work_dir: String) -> Result<()> {
    let checkpoint_dir = checkpoint_root()?.join(&checkpoint_id);
    let manifest_path = checkpoint_dir.join("manifest.json");

    if !manifest_path.exists() {
        return Err(Error::from_reason(format!(
            "Checkpoint not found: {}",
            checkpoint_id
        )));
    }

    let manifest_json = fs::read_to_string(&manifest_path)
        .map_err(|e| Error::from_reason(format!("Failed to read checkpoint manifest: {}", e)))?;
    let manifest: CheckpointManifest = serde_json::from_str(&manifest_json)
        .map_err(|e| Error::from_reason(format!("Failed to parse checkpoint manifest: {}", e)))?;

    let files_dir = checkpoint_dir.join("files");
    let root = Path::new(&work_dir);

    let manifest_set: HashSet<&String> = manifest.files.iter().collect();

    // Step 1: Remove files that were created after the checkpoint.
    delete_extra_files(root, root, &manifest_set, 0)?;

    // Step 2: Restore all files from the checkpoint snapshot.
    for rel_str in &manifest.files {
        let rel = from_forward_slashes(rel_str);
        let src = files_dir.join(&rel);
        let dest = root.join(&rel);
        if let Some(parent) = dest.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::copy(&src, &dest);
    }

    Ok(())
}

fn delete_extra_files(
    root: &Path,
    current: &Path,
    manifest_set: &HashSet<&String>,
    depth: usize,
) -> Result<()> {
    if depth > MAX_DEPTH {
        return Ok(());
    }

    let entries = match fs::read_dir(current) {
        Ok(e) => e,
        Err(_) => return Ok(()),
    };

    let mut sub_dirs: Vec<PathBuf> = Vec::new();

    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        let name = entry.file_name().to_string_lossy().to_string();

        let file_type = match entry.file_type() {
            Ok(t) => t,
            Err(_) => continue,
        };

        if file_type.is_symlink() {
            continue;
        }

        let full_path = entry.path();

        if file_type.is_dir() {
            if should_skip_dir(&name) {
                continue;
            }
            sub_dirs.push(full_path);
        } else if file_type.is_file() {
            let relative = match full_path.strip_prefix(root) {
                Ok(rel) => rel,
                Err(_) => continue,
            };
            let rel_str = to_forward_slashes(relative);
            if !manifest_set.contains(&rel_str) {
                // This file did not exist at checkpoint time — remove it.
                let _ = fs::remove_file(&full_path);
            }
        }
    }

    // Recurse into sub-directories (post-order so we can prune empties).
    for dir in sub_dirs {
        delete_extra_files(root, &dir, manifest_set, depth + 1)?;
    }

    // Remove the directory if it is now empty (only succeeds when empty).
    // Never remove the work-dir root itself.
    if current != root {
        let _ = fs::remove_dir(current);
    }

    Ok(())
}

/// Delete a checkpoint and all its stored files.
pub fn delete_checkpoint(checkpoint_id: String) -> Result<()> {
    let checkpoint_dir = checkpoint_root()?.join(&checkpoint_id);
    if checkpoint_dir.exists() {
        fs::remove_dir_all(&checkpoint_dir).map_err(|e| {
            Error::from_reason(format!("Failed to delete checkpoint '{}': {}", checkpoint_id, e))
        })?;
    }
    Ok(())
}

/// A single file change between the checkpoint snapshot and the current
/// working directory state.
#[napi(object)]
pub struct CheckpointFileChange {
    /// Relative file path (forward-slash separated).
    pub path: String,
    /// "added" (created after checkpoint, will be deleted),
    /// "modified" (content differs, will be reverted),
    /// "deleted" (existed at checkpoint, was removed, will be restored).
    pub change_type: String,
}

/// Compare the working directory against a checkpoint snapshot and return
/// the list of files that differ. Does NOT modify any files — purely a
/// read-only diff used to show the user what rollback would change.
pub fn list_checkpoint_changes(
    checkpoint_id: String,
    work_dir: String,
) -> Result<Vec<CheckpointFileChange>> {
    let checkpoint_dir = checkpoint_root()?.join(&checkpoint_id);
    let manifest_path = checkpoint_dir.join("manifest.json");

    if !manifest_path.exists() {
        return Err(Error::from_reason(format!(
            "Checkpoint not found: {}",
            checkpoint_id
        )));
    }

    let manifest_json = fs::read_to_string(&manifest_path)
        .map_err(|e| Error::from_reason(format!("Failed to read checkpoint manifest: {}", e)))?;
    let manifest: CheckpointManifest = serde_json::from_str(&manifest_json)
        .map_err(|e| Error::from_reason(format!("Failed to parse checkpoint manifest: {}", e)))?;

    let files_dir = checkpoint_dir.join("files");
    let root = Path::new(&work_dir);

    let manifest_set: HashSet<String> = manifest.files.iter().cloned().collect();
    let mut current_files: HashSet<String> = HashSet::new();
    let mut changes: Vec<CheckpointFileChange> = Vec::new();

    // Walk the current work directory to find added & modified files.
    collect_changes(root, root, &files_dir, &manifest_set, &mut current_files, &mut changes, 0)?;

    // Find deleted files: in manifest but not in current work directory.
    for rel_str in &manifest.files {
        if !current_files.contains(rel_str) {
            changes.push(CheckpointFileChange {
                path: rel_str.clone(),
                change_type: "deleted".to_string(),
            });
        }
    }

    // Sort for stable display order.
    changes.sort_by(|a, b| a.path.cmp(&b.path));

    Ok(changes)
}

fn collect_changes(
    root: &Path,
    current: &Path,
    files_dir: &Path,
    manifest_set: &HashSet<String>,
    current_files: &mut HashSet<String>,
    changes: &mut Vec<CheckpointFileChange>,
    depth: usize,
) -> Result<()> {
    if depth > MAX_DEPTH {
        return Ok(());
    }

    let entries = match fs::read_dir(current) {
        Ok(e) => e,
        Err(_) => return Ok(()),
    };

    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        let name = entry.file_name().to_string_lossy().to_string();
        let file_type = match entry.file_type() {
            Ok(t) => t,
            Err(_) => continue,
        };

        if file_type.is_symlink() {
            continue;
        }

        let full_path = entry.path();

        if file_type.is_dir() {
            if should_skip_dir(&name) {
                continue;
            }
            collect_changes(root, &full_path, files_dir, manifest_set, current_files, changes, depth + 1)?;
        } else if file_type.is_file() {
            let relative = match full_path.strip_prefix(root) {
                Ok(rel) => rel,
                Err(_) => continue,
            };
            let rel_str = to_forward_slashes(relative);
            current_files.insert(rel_str.clone());

            if !manifest_set.contains(&rel_str) {
                // File was created after the checkpoint.
                changes.push(CheckpointFileChange {
                    path: rel_str,
                    change_type: "added".to_string(),
                });
            } else {
                // File existed at checkpoint — compare content.
                let snapshot_path = files_dir.join(relative);
                if files_are_different(&full_path, &snapshot_path) {
                    changes.push(CheckpointFileChange {
                        path: rel_str,
                        change_type: "modified".to_string(),
                    });
                }
            }
        }
    }

    Ok(())
}

/// Compare two files by size first, then by content. Returns true if they
/// differ (or if either file cannot be read).
fn files_are_different(a: &Path, b: &Path) -> bool {
    let meta_a = match fs::metadata(a) {
        Ok(m) => m,
        Err(_) => return true,
    };
    let meta_b = match fs::metadata(b) {
        Ok(m) => m,
        Err(_) => return true,
    };

    if meta_a.len() != meta_b.len() {
        return true;
    }

    // Same size — compare content byte-by-byte.
    let content_a = match fs::read(a) {
        Ok(c) => c,
        Err(_) => return true,
    };
    let content_b = match fs::read(b) {
        Ok(c) => c,
        Err(_) => return true,
    };

    content_a != content_b
}
