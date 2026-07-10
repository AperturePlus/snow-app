use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Output};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use napi::bindgen_prelude::*;
use napi_derive::napi;
use serde::{Deserialize, Serialize};
use similar::TextDiff;

const CHECKPOINT_DIR_NAME: &str = "checkpoints";
const OBJECT_DIR_NAME: &str = "objects";
const MANIFEST_VERSION: u32 = 2;

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
static CHECKPOINT_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Serialize, Deserialize)]
struct CheckpointManifest {
    version: u32,
    work_dir: String,
    git: Option<GitBaseline>,
    #[serde(default)]
    terminal_capture: bool,
    entries: Vec<CheckpointEntry>,
}

#[derive(Serialize, Deserialize)]
struct GitBaseline {
    repository_root: String,
    work_dir_prefix: String,
    head: String,
}

#[derive(Serialize, Deserialize)]
struct CheckpointEntry {
    path: String,
    original: OriginalState,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum OriginalState {
    Missing,
    Object { object_id: String },
    Git,
}
fn checkpoint_root() -> Result<PathBuf> {
    let storage_dir = crate::storage::paths::app_storage_dir()?;
    Ok(storage_dir.join(CHECKPOINT_DIR_NAME))
}

fn checkpoint_guard() -> Result<MutexGuard<'static, ()>> {
    CHECKPOINT_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| Error::from_reason("Checkpoint state lock is poisoned"))
}

fn should_skip_relative(path: &Path) -> bool {
    path.components().any(|component| match component {
        Component::Normal(name) => name
            .to_str()
            .map(|value| SKIP_DIRS.contains(&value))
            .unwrap_or(false),
        _ => false,
    })
}

fn generate_checkpoint_id() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let count = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("cp-{}-{}-{}", now.as_secs(), now.subsec_nanos(), count)
}

fn to_forward_slashes(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn from_forward_slashes(relative: &str) -> PathBuf {
    PathBuf::from(relative.replace(
        '/',
        &std::path::MAIN_SEPARATOR.to_string(),
    ))
}

fn canonical_work_dir(work_dir: &str) -> Result<PathBuf> {
    let root = Path::new(work_dir);
    if !root.exists() {
        return Err(Error::from_reason(format!(
            "Working directory does not exist: {work_dir}"
        )));
    }
    if !root.is_dir() {
        return Err(Error::from_reason(format!(
            "Path is not a directory: {work_dir}"
        )));
    }
    fs::canonicalize(root).map_err(|error| {
        Error::from_reason(format!(
            "Failed to resolve working directory '{}': {error}",
            root.display()
        ))
    })
}

fn normalize_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            other => normalized.push(other.as_os_str()),
        }
    }
    normalized
}

fn resolve_checkpoint_path(root: &Path, file_path: &str) -> Result<(PathBuf, PathBuf)> {
    let supplied = Path::new(file_path);
    let candidate = if supplied.is_absolute() {
        supplied.to_path_buf()
    } else {
        root.join(supplied)
    };
    let normalized = if candidate.exists() {
        fs::canonicalize(&candidate).map_err(|error| {
            Error::from_reason(format!(
                "Failed to resolve checkpoint path '{}': {error}",
                candidate.display()
            ))
        })?
    } else {
        normalize_path(&candidate)
    };

    if !normalized.starts_with(root) {
        return Err(Error::from_reason(format!(
            "Path '{}' is outside checkpoint working directory '{}'",
            normalized.display(),
            root.display()
        )));
    }

    let relative = normalized
        .strip_prefix(root)
        .map_err(|_| Error::from_reason("Failed to create checkpoint-relative path"))?
        .to_path_buf();
    Ok((normalized, relative))
}

fn checkpoint_dir(checkpoint_id: &str) -> Result<PathBuf> {
    Ok(checkpoint_root()?.join(checkpoint_id))
}

fn manifest_path(checkpoint_id: &str) -> Result<PathBuf> {
    Ok(checkpoint_dir(checkpoint_id)?.join("manifest.json"))
}

fn read_manifest(checkpoint_id: &str) -> Result<CheckpointManifest> {
    let path = manifest_path(checkpoint_id)?;
    let json = fs::read_to_string(&path).map_err(|error| {
        Error::from_reason(format!(
            "Failed to read checkpoint manifest '{}': {error}",
            path.display()
        ))
    })?;
    let manifest: CheckpointManifest = serde_json::from_str(&json).map_err(|error| {
        Error::from_reason(format!(
            "Failed to parse checkpoint manifest '{}': {error}",
            path.display()
        ))
    })?;
    if manifest.version != MANIFEST_VERSION {
        return Err(Error::from_reason(format!(
            "Unsupported checkpoint format version: {}",
            manifest.version
        )));
    }
    Ok(manifest)
}

fn write_manifest(checkpoint_id: &str, manifest: &CheckpointManifest) -> Result<()> {
    let directory = checkpoint_dir(checkpoint_id)?;
    fs::create_dir_all(&directory).map_err(|error| {
        Error::from_reason(format!(
            "Failed to create checkpoint directory '{}': {error}",
            directory.display()
        ))
    })?;
    let json = serde_json::to_vec(manifest).map_err(|error| {
        Error::from_reason(format!("Failed to serialize checkpoint manifest: {error}"))
    })?;
    let temporary = directory.join(format!("manifest-{}.tmp", generate_checkpoint_id()));
    fs::write(&temporary, json).map_err(|error| {
        Error::from_reason(format!(
            "Failed to write checkpoint manifest '{}': {error}",
            temporary.display()
        ))
    })?;
    fs::rename(&temporary, directory.join("manifest.json")).map_err(|error| {
        let _ = fs::remove_file(&temporary);
        Error::from_reason(format!("Failed to publish checkpoint manifest: {error}"))
    })
}

fn run_git(work_dir: &Path, args: &[&str]) -> Result<Output> {
    Command::new("git")
        .args(args)
        .current_dir(work_dir)
        .output()
        .map_err(|error| Error::from_reason(format!("Failed to execute git: {error}")))
}

fn git_text(work_dir: &Path, args: &[&str]) -> Option<String> {
    let output = run_git(work_dir, args).ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn detect_git_baseline(work_dir: &Path) -> Option<GitBaseline> {
    let repository_root = git_text(work_dir, &["rev-parse", "--show-toplevel"])?;
    let head = git_text(work_dir, &["rev-parse", "HEAD"])?;
    let repository_root = fs::canonicalize(repository_root).ok()?;
    let prefix = work_dir.strip_prefix(&repository_root).ok()?;
    Some(GitBaseline {
        repository_root: repository_root.to_string_lossy().to_string(),
        work_dir_prefix: to_forward_slashes(prefix),
        head,
    })
}

fn checkpoint_git_ref(checkpoint_id: &str) -> String {
    format!("refs/snow/checkpoints/{checkpoint_id}")
}

fn update_checkpoint_git_ref(
    checkpoint_id: &str,
    baseline: &GitBaseline,
    delete: bool,
) -> Result<()> {
    let repository_root = Path::new(&baseline.repository_root);
    let reference = checkpoint_git_ref(checkpoint_id);
    let output = if delete {
        run_git(repository_root, &["update-ref", "-d", &reference])?
    } else {
        run_git(
            repository_root,
            &["update-ref", &reference, &baseline.head],
        )?
    };
    if output.status.success() {
        Ok(())
    } else {
        Err(Error::from_reason(format!(
            "Failed to update checkpoint Git reference: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )))
    }
}

fn parse_nul_paths(output: &[u8]) -> Vec<String> {
    output
        .split(|byte| *byte == 0)
        .filter(|part| !part.is_empty())
        .map(|part| String::from_utf8_lossy(part).to_string())
        .collect()
}

fn repository_pathspec(baseline: &GitBaseline) -> String {
    if baseline.work_dir_prefix.is_empty() {
        ".".to_string()
    } else {
        baseline.work_dir_prefix.clone()
    }
}

fn repository_to_work_path(baseline: &GitBaseline, repository_path: &str) -> Option<String> {
    if baseline.work_dir_prefix.is_empty() {
        return Some(repository_path.to_string());
    }
    let prefix = format!("{}/", baseline.work_dir_prefix.trim_end_matches('/'));
    repository_path.strip_prefix(&prefix).map(str::to_string)
}

fn collect_git_change_paths(baseline: &GitBaseline) -> Result<HashSet<String>> {
    let repository_root = Path::new(&baseline.repository_root);
    let pathspec = repository_pathspec(baseline);
    let mut paths = HashSet::new();

    let diff = run_git(
        repository_root,
        &[
            "diff",
            "--name-only",
            "-z",
            &baseline.head,
            "--",
            &pathspec,
        ],
    )?;
    if !diff.status.success() {
        return Err(Error::from_reason(format!(
            "Failed to inspect Git checkpoint changes: {}",
            String::from_utf8_lossy(&diff.stderr).trim()
        )));
    }
    for path in parse_nul_paths(&diff.stdout) {
        if let Some(relative) = repository_to_work_path(baseline, &path) {
            paths.insert(relative);
        }
    }

    let untracked = run_git(
        repository_root,
        &[
            "ls-files",
            "--others",
            "--exclude-standard",
            "-z",
            "--",
            &pathspec,
        ],
    )?;
    if !untracked.status.success() {
        return Err(Error::from_reason(format!(
            "Failed to inspect untracked checkpoint files: {}",
            String::from_utf8_lossy(&untracked.stderr).trim()
        )));
    }
    for path in parse_nul_paths(&untracked.stdout) {
        if let Some(relative) = repository_to_work_path(baseline, &path) {
            paths.insert(relative);
        }
    }

    Ok(paths)
}

fn git_object_spec(baseline: &GitBaseline, relative: &str) -> String {
    let repository_path = if baseline.work_dir_prefix.is_empty() {
        relative.to_string()
    } else {
        format!(
            "{}/{}",
            baseline.work_dir_prefix.trim_end_matches('/'),
            relative
        )
    };
    format!("{}:{}", baseline.head, repository_path)
}

fn read_git_object(baseline: &GitBaseline, relative: &str) -> Result<Option<Vec<u8>>> {
    let repository_root = Path::new(&baseline.repository_root);
    let object_spec = git_object_spec(baseline, relative);
    let output = run_git(repository_root, &["show", &object_spec])?;
    if output.status.success() {
        Ok(Some(output.stdout))
    } else {
        Ok(None)
    }
}

fn git_object_exists(baseline: &GitBaseline, relative: &str) -> Result<bool> {
    let repository_root = Path::new(&baseline.repository_root);
    let object_spec = git_object_spec(baseline, relative);
    Ok(run_git(repository_root, &["cat-file", "-e", &object_spec])?
        .status
        .success())
}

fn store_object(path: &Path) -> Result<String> {
    let object_dir = checkpoint_root()?.join(OBJECT_DIR_NAME);
    fs::create_dir_all(&object_dir).map_err(|error| {
        Error::from_reason(format!(
            "Failed to create checkpoint object directory: {error}"
        ))
    })?;
    let temporary = object_dir.join(format!("{}.tmp", generate_checkpoint_id()));
    let mut source = File::open(path).map_err(|error| {
        Error::from_reason(format!(
            "Failed to read checkpoint source '{}': {error}",
            path.display()
        ))
    })?;
    let mut destination = File::create(&temporary).map_err(|error| {
        Error::from_reason(format!(
            "Failed to create checkpoint object '{}': {error}",
            temporary.display()
        ))
    })?;
    let mut hasher = blake3::Hasher::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = source.read(&mut buffer).map_err(|error| {
            Error::from_reason(format!("Failed to read checkpoint source: {error}"))
        })?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
        destination.write_all(&buffer[..count]).map_err(|error| {
            Error::from_reason(format!("Failed to write checkpoint object: {error}"))
        })?;
    }
    destination.flush().map_err(|error| {
        Error::from_reason(format!("Failed to flush checkpoint object: {error}"))
    })?;

    let object_id = hasher.finalize().to_hex().to_string();
    let final_path = object_dir.join(&object_id);
    if final_path.exists() {
        let _ = fs::remove_file(&temporary);
    } else {
        fs::rename(&temporary, &final_path).map_err(|error| {
            let _ = fs::remove_file(&temporary);
            Error::from_reason(format!("Failed to publish checkpoint object: {error}"))
        })?;
    }
    Ok(object_id)
}

fn current_state(path: &Path) -> Result<OriginalState> {
    if !path.exists() {
        return Ok(OriginalState::Missing);
    }
    if !path.is_file() {
        return Err(Error::from_reason(format!(
            "Checkpoint path is not a regular file: {}",
            path.display()
        )));
    }
    Ok(OriginalState::Object {
        object_id: store_object(path)?,
    })
}

fn capture_entry(
    manifest: &mut CheckpointManifest,
    absolute: &Path,
    relative: &Path,
    prefer_git_baseline: bool,
) -> Result<()> {
    if relative.as_os_str().is_empty() || should_skip_relative(relative) {
        return Ok(());
    }
    let path = to_forward_slashes(relative);
    if manifest.entries.iter().any(|entry| entry.path == path) {
        return Ok(());
    }

    let original = match manifest.git.as_ref() {
        Some(baseline)
            if prefer_git_baseline && git_object_exists(baseline, &path)? =>
        {
            OriginalState::Git
        }
        _ => current_state(absolute)?,
    };
    manifest.entries.push(CheckpointEntry { path, original });
    Ok(())
}

fn validate_manifest_work_dir(manifest: &CheckpointManifest, work_dir: &str) -> Result<PathBuf> {
    let requested = canonical_work_dir(work_dir)?;
    let recorded = PathBuf::from(&manifest.work_dir);
    if requested != recorded {
        return Err(Error::from_reason(format!(
            "Checkpoint belongs to '{}', not '{}'",
            recorded.display(),
            requested.display()
        )));
    }
    Ok(requested)
}

/// Create an incremental checkpoint without copying the working directory.
/// File content is captured lazily, immediately before a tool first changes it.
pub fn create_checkpoint(work_dir: String) -> Result<String> {
    let _guard = checkpoint_guard()?;
    let root = canonical_work_dir(&work_dir)?;
    let checkpoint_id = generate_checkpoint_id();
    let manifest = CheckpointManifest {
        version: MANIFEST_VERSION,
        work_dir: root.to_string_lossy().to_string(),
        git: detect_git_baseline(&root),
        terminal_capture: false,
        entries: Vec::new(),
    };

    write_manifest(&checkpoint_id, &manifest)?;
    if let Some(baseline) = manifest.git.as_ref() {
        if let Err(error) = update_checkpoint_git_ref(&checkpoint_id, baseline, false) {
            let _ = fs::remove_dir_all(checkpoint_dir(&checkpoint_id)?);
            return Err(error);
        }
    }
    Ok(checkpoint_id)
}

/// Capture the original state of one file before a filesystem tool changes it.
pub fn record_checkpoint_file(
    checkpoint_ids: Vec<String>,
    work_dir: String,
    file_path: String,
) -> Result<()> {
    if checkpoint_ids.is_empty() {
        return Ok(());
    }
    let _guard = checkpoint_guard()?;
    let root = canonical_work_dir(&work_dir)?;
    let (absolute, relative) = resolve_checkpoint_path(&root, &file_path)?;

    for checkpoint_id in checkpoint_ids {
        let mut manifest = read_manifest(&checkpoint_id)?;
        validate_manifest_work_dir(&manifest, &work_dir)?;
        let entry_count = manifest.entries.len();
        capture_entry(&mut manifest, &absolute, &relative, false)?;
        if manifest.entries.len() != entry_count {
            write_manifest(&checkpoint_id, &manifest)?;
        }
    }
    Ok(())
}

/// Capture Git-visible paths before a terminal command runs. Existing Git
/// objects are referenced by commit id; only untracked or pre-modified files
/// are copied into the shared content-addressed object store.
pub fn record_checkpoint_worktree(
    checkpoint_ids: Vec<String>,
    work_dir: String,
) -> Result<()> {
    if checkpoint_ids.is_empty() {
        return Ok(());
    }
    let _guard = checkpoint_guard()?;

    for checkpoint_id in checkpoint_ids {
        let mut manifest = read_manifest(&checkpoint_id)?;
        let root = validate_manifest_work_dir(&manifest, &work_dir)?;
        let Some(baseline) = manifest.git.as_ref() else {
            continue;
        };
        let paths = collect_git_change_paths(baseline)?;
        let entry_count = manifest.entries.len();
        for relative_path in paths {
            let relative = from_forward_slashes(&relative_path);
            let absolute = root.join(&relative);
            capture_entry(&mut manifest, &absolute, &relative, false)?;
        }
        if !manifest.terminal_capture || manifest.entries.len() != entry_count {
            manifest.terminal_capture = true;
            write_manifest(&checkpoint_id, &manifest)?;
        }
    }
    Ok(())
}

/// Restore only paths that were recorded by mutating tools after this checkpoint.
pub fn restore_checkpoint(checkpoint_id: String, work_dir: String) -> Result<()> {
    let _guard = checkpoint_guard()?;
    let manifest = read_manifest(&checkpoint_id)?;
    let root = validate_manifest_work_dir(&manifest, &work_dir)?;

    for entry in &manifest.entries {
        restore_entry(&root, &manifest, entry)?;
    }

    if manifest.terminal_capture {
        let baseline = manifest.git.as_ref().ok_or_else(|| {
            Error::from_reason("Checkpoint Git baseline is missing")
        })?;
        let recorded_paths: HashSet<&str> = manifest
            .entries
            .iter()
            .map(|entry| entry.path.as_str())
            .collect();
        for path in collect_git_change_paths(baseline)? {
            if recorded_paths.contains(path.as_str()) {
                continue;
            }
            let destination = root.join(from_forward_slashes(&path));
            if let Some(content) = read_git_object(baseline, &path)? {
                write_file(&destination, &content)?;
            } else if destination.is_file() || destination.is_symlink() {
                fs::remove_file(&destination).map_err(|error| {
                    Error::from_reason(format!(
                        "Failed to remove added file '{}': {error}",
                        destination.display()
                    ))
                })?;
            }
        }
    }

    prune_empty_parent_directories(&root, &manifest.entries);
    Ok(())
}

fn restore_entry(
    root: &Path,
    manifest: &CheckpointManifest,
    entry: &CheckpointEntry,
) -> Result<()> {
    let destination = root.join(from_forward_slashes(&entry.path));
    match &entry.original {
        OriginalState::Missing => {
            if destination.is_file() || destination.is_symlink() {
                fs::remove_file(&destination).map_err(|error| {
                    Error::from_reason(format!(
                        "Failed to remove added file '{}': {error}",
                        destination.display()
                    ))
                })?;
            }
            Ok(())
        }
        OriginalState::Object { object_id } => {
            let source = checkpoint_root()?.join(OBJECT_DIR_NAME).join(object_id);
            restore_file(&source, &destination)
        }
        OriginalState::Git => {
            let baseline = manifest.git.as_ref().ok_or_else(|| {
                Error::from_reason("Checkpoint Git baseline is missing")
            })?;
            let content = read_git_object(baseline, &entry.path)?.ok_or_else(|| {
                Error::from_reason(format!(
                    "Checkpoint Git object is missing for '{}'",
                    entry.path
                ))
            })?;
            write_file(&destination, &content)
        }
    }
}

fn restore_file(source: &Path, destination: &Path) -> Result<()> {
    if !source.is_file() {
        return Err(Error::from_reason(format!(
            "Checkpoint object not found: {}",
            source.display()
        )));
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            Error::from_reason(format!(
                "Failed to create restore directory '{}': {error}",
                parent.display()
            ))
        })?;
    }
    fs::copy(source, destination).map_err(|error| {
        Error::from_reason(format!(
            "Failed to restore file '{}': {error}",
            destination.display()
        ))
    })?;
    Ok(())
}

fn write_file(destination: &Path, content: &[u8]) -> Result<()> {
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            Error::from_reason(format!(
                "Failed to create restore directory '{}': {error}",
                parent.display()
            ))
        })?;
    }
    fs::write(destination, content).map_err(|error| {
        Error::from_reason(format!(
            "Failed to restore file '{}': {error}",
            destination.display()
        ))
    })
}

fn prune_empty_parent_directories(root: &Path, entries: &[CheckpointEntry]) {
    let mut directories: Vec<PathBuf> = entries
        .iter()
        .filter_map(|entry| root.join(from_forward_slashes(&entry.path)).parent().map(Path::to_path_buf))
        .collect();
    directories.sort_by_key(|path| std::cmp::Reverse(path.components().count()));
    directories.dedup();
    for directory in directories {
        let mut current = directory;
        while current.starts_with(root) && current != root {
            if fs::remove_dir(&current).is_err() {
                break;
            }
            let Some(parent) = current.parent() else {
                break;
            };
            current = parent.to_path_buf();
        }
    }
}

/// Delete a checkpoint and release its Git reference. Shared objects are
/// garbage-collected once no remaining manifest references them.
pub fn delete_checkpoint(checkpoint_id: String) -> Result<()> {
    let _guard = checkpoint_guard()?;
    let directory = checkpoint_dir(&checkpoint_id)?;
    if !directory.exists() {
        return Ok(());
    }

    if let Ok(manifest) = read_manifest(&checkpoint_id) {
        if let Some(baseline) = manifest.git.as_ref() {
            update_checkpoint_git_ref(&checkpoint_id, baseline, true)?;
        }
    }
    fs::remove_dir_all(&directory).map_err(|error| {
        Error::from_reason(format!(
            "Failed to delete checkpoint '{}': {error}",
            checkpoint_id
        ))
    })?;
    collect_unused_objects()
}

fn collect_unused_objects() -> Result<()> {
    let root = checkpoint_root()?;
    let object_dir = root.join(OBJECT_DIR_NAME);
    if !object_dir.is_dir() {
        return Ok(());
    }

    let mut referenced = HashSet::new();
    if let Ok(entries) = fs::read_dir(&root) {
        for entry in entries.flatten() {
            if !entry.path().is_dir() || entry.file_name() == OBJECT_DIR_NAME {
                continue;
            }
            let checkpoint_id = entry.file_name().to_string_lossy().to_string();
            if let Ok(manifest) = read_manifest(&checkpoint_id) {
                for item in manifest.entries {
                    if let OriginalState::Object { object_id } = item.original {
                        referenced.insert(object_id);
                    }
                }
            }
        }
    }

    for entry in fs::read_dir(&object_dir).map_err(|error| {
        Error::from_reason(format!("Failed to scan checkpoint objects: {error}"))
    })? {
        let entry = entry.map_err(|error| {
            Error::from_reason(format!("Failed to read checkpoint object entry: {error}"))
        })?;
        let name = entry.file_name().to_string_lossy().to_string();
        if entry.path().is_file() && !referenced.contains(&name) {
            fs::remove_file(entry.path()).map_err(|error| {
                Error::from_reason(format!("Failed to remove unused checkpoint object: {error}"))
            })?;
        }
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

/// A file change with a unified diff suitable for rollback preview.
#[napi(object)]
pub struct CheckpointFileDiff {
    pub path: String,
    pub change_type: String,
    pub content: String,
    pub is_binary: bool,
}

fn collect_tracked_states(
    manifest: &CheckpointManifest,
) -> Result<HashMap<String, OriginalState>> {
    let mut tracked: HashMap<String, OriginalState> = manifest
        .entries
        .iter()
        .map(|entry| (entry.path.clone(), entry.original.clone()))
        .collect();

    if manifest.terminal_capture {
        if let Some(baseline) = manifest.git.as_ref() {
            for path in collect_git_change_paths(baseline)? {
                tracked.entry(path).or_insert(OriginalState::Git);
            }
        }
    }

    Ok(tracked)
}

/// Compare only recorded paths. Git-backed checkpoints additionally include
/// paths changed by terminal commands, without walking the working directory.
pub fn list_checkpoint_changes(
    checkpoint_id: String,
    work_dir: String,
) -> Result<Vec<CheckpointFileChange>> {
    let _guard = checkpoint_guard()?;
    let manifest = read_manifest(&checkpoint_id)?;
    let root = validate_manifest_work_dir(&manifest, &work_dir)?;
    let tracked = collect_tracked_states(&manifest)?;

    let mut changes = Vec::new();
    for (path, original) in tracked {
        if should_skip_relative(Path::new(&path)) {
            continue;
        }
        let current = root.join(from_forward_slashes(&path));
        if let Some(change_type) =
            classify_change(&current, &original, manifest.git.as_ref(), &path)?
        {
            changes.push(CheckpointFileChange { path, change_type });
        }
    }
    changes.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(changes)
}

/// Build unified diffs from checkpoint content to the current working state.
/// This is read-only and is used by the renderer's rollback preview.
pub fn list_checkpoint_diffs(
    checkpoint_id: String,
    work_dir: String,
) -> Result<Vec<CheckpointFileDiff>> {
    let _guard = checkpoint_guard()?;
    let manifest = read_manifest(&checkpoint_id)?;
    let root = validate_manifest_work_dir(&manifest, &work_dir)?;
    let tracked = collect_tracked_states(&manifest)?;

    let mut diffs = Vec::new();
    for (path, original) in tracked {
        if should_skip_relative(Path::new(&path)) {
            continue;
        }
        let current = root.join(from_forward_slashes(&path));
        let Some(change_type) =
            classify_change(&current, &original, manifest.git.as_ref(), &path)?
        else {
            continue;
        };
        let original_content =
            read_original_content(&original, manifest.git.as_ref(), &path)?;
        let current_content = read_current_content(&current)?;
        let (content, is_binary) = build_unified_diff(
            &path,
            original_content.as_deref(),
            current_content.as_deref(),
        );
        diffs.push(CheckpointFileDiff {
            path,
            change_type,
            content,
            is_binary,
        });
    }
    diffs.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(diffs)
}

fn read_original_content(
    original: &OriginalState,
    baseline: Option<&GitBaseline>,
    relative: &str,
) -> Result<Option<Vec<u8>>> {
    match original {
        OriginalState::Missing => Ok(None),
        OriginalState::Object { object_id } => {
            let object = checkpoint_root()?.join(OBJECT_DIR_NAME).join(object_id);
            fs::read(&object).map(Some).map_err(|error| {
                Error::from_reason(format!(
                    "Failed to read checkpoint object '{}': {error}",
                    object.display()
                ))
            })
        }
        OriginalState::Git => {
            let baseline = baseline.ok_or_else(|| {
                Error::from_reason("Checkpoint Git baseline is missing")
            })?;
            read_git_object(baseline, relative)
        }
    }
}

fn read_current_content(path: &Path) -> Result<Option<Vec<u8>>> {
    if !path.exists() {
        return Ok(None);
    }
    if !path.is_file() {
        return Err(Error::from_reason(format!(
            "Checkpoint path is not a regular file: {}",
            path.display()
        )));
    }
    fs::read(path).map(Some).map_err(|error| {
        Error::from_reason(format!(
            "Failed to read current checkpoint file '{}': {error}",
            path.display()
        ))
    })
}

fn build_unified_diff(
    relative: &str,
    original: Option<&[u8]>,
    current: Option<&[u8]>,
) -> (String, bool) {
    let original_bytes = original.unwrap_or_default();
    let current_bytes = current.unwrap_or_default();
    let Ok(original_text) = std::str::from_utf8(original_bytes) else {
        return (String::new(), true);
    };
    let Ok(current_text) = std::str::from_utf8(current_bytes) else {
        return (String::new(), true);
    };
    if original_bytes.contains(&0) || current_bytes.contains(&0) {
        return (String::new(), true);
    }

    let original_header = original
        .map(|_| format!("a/{relative}"))
        .unwrap_or_else(|| "/dev/null".to_string());
    let current_header = current
        .map(|_| format!("b/{relative}"))
        .unwrap_or_else(|| "/dev/null".to_string());
    let content = TextDiff::from_lines(original_text, current_text)
        .unified_diff()
        .context_radius(3)
        .header(&original_header, &current_header)
        .to_string();
    (content, false)
}

fn classify_change(
    current: &Path,
    original: &OriginalState,
    baseline: Option<&GitBaseline>,
    relative: &str,
) -> Result<Option<String>> {
    match original {
        OriginalState::Missing => Ok(current.exists().then(|| "added".to_string())),
        OriginalState::Object { object_id } => {
            if !current.exists() {
                return Ok(Some("deleted".to_string()));
            }
            let object = checkpoint_root()?.join(OBJECT_DIR_NAME).join(object_id);
            Ok(files_are_different(current, &object).then(|| "modified".to_string()))
        }
        OriginalState::Git => {
            let baseline = baseline.ok_or_else(|| {
                Error::from_reason("Checkpoint Git baseline is missing")
            })?;
            let Some(content) = read_git_object(baseline, relative)? else {
                return Ok(current.exists().then(|| "added".to_string()));
            };
            if !current.exists() {
                return Ok(Some("deleted".to_string()));
            }
            Ok(file_differs_from_bytes(current, &content).then(|| "modified".to_string()))
        }
    }
}

fn file_differs_from_bytes(path: &Path, expected: &[u8]) -> bool {
    let metadata = match fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(_) => return true,
    };
    if metadata.len() != expected.len() as u64 {
        return true;
    }
    fs::read(path).map(|content| content != expected).unwrap_or(true)
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
