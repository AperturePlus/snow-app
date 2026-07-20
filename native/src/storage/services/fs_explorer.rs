use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicUsize, Ordering};

use napi::bindgen_prelude::*;
use napi_derive::napi;

#[napi(object)]
pub struct DirectoryEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub size: i64,
}

#[napi(object)]
pub struct FileContentResult {
    pub content: String,
    pub is_binary: bool,
    pub is_image: bool,
    pub is_svg: bool,
    pub mime_type: String,
    pub encoding: String,
    pub size: i64,
}

const IMAGE_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "bmp", "webp", "ico", "svg",
];

const MIME_TYPES: &[(&str, &str)] = &[
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("gif", "image/gif"),
    ("bmp", "image/bmp"),
    ("webp", "image/webp"),
    ("ico", "image/x-icon"),
    ("svg", "image/svg+xml"),
];

fn get_mime_type(ext: &str) -> String {
    for (e, mime) in MIME_TYPES {
        if *e == ext {
            return mime.to_string();
        }
    }
    "application/octet-stream".to_string()
}

pub fn process_file_content(file_path: &str, buffer: Vec<u8>) -> FileContentResult {
    let ext = Path::new(file_path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_lowercase())
        .unwrap_or_default();

    let is_svg = ext == "svg";
    let is_image = IMAGE_EXTENSIONS.contains(&ext.as_str());
    let size = buffer.len() as i64;

    if is_svg {
        return FileContentResult {
            content: String::from_utf8_lossy(&buffer).into_owned(),
            is_binary: false,
            is_image: true,
            is_svg: true,
            mime_type: "image/svg+xml".to_string(),
            encoding: "utf8".to_string(),
            size,
        };
    }

    if is_image {
        return FileContentResult {
            content: base64_encode(&buffer),
            is_binary: true,
            is_image: true,
            is_svg: false,
            mime_type: get_mime_type(&ext),
            encoding: "base64".to_string(),
            size,
        };
    }

    let check_len = buffer.len().min(8192);
    let is_binary = buffer[..check_len].iter().any(|&b| b == 0);

    if is_binary {
        return FileContentResult {
            content: base64_encode(&buffer),
            is_binary: true,
            is_image: false,
            is_svg: false,
            mime_type: "application/octet-stream".to_string(),
            encoding: "base64".to_string(),
            size,
        };
    }

    FileContentResult {
        content: String::from_utf8_lossy(&buffer).into_owned(),
        is_binary: false,
        is_image: false,
        is_svg: false,
        mime_type: "text/plain".to_string(),
        encoding: "utf8".to_string(),
        size,
    }
}

fn base64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::with_capacity((data.len() + 2) / 3 * 4);

    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };

        let triple = (b0 << 16) | (b1 << 8) | b2;

        result.push(CHARS[((triple >> 18) & 0x3F) as usize] as char);
        result.push(CHARS[((triple >> 12) & 0x3F) as usize] as char);

        if chunk.len() > 1 {
            result.push(CHARS[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }

        if chunk.len() > 2 {
            result.push(CHARS[(triple & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
    }

    result
}

#[napi(object)]
pub struct FileSearchResult {
    pub path: String,
    pub relative_path: String,
    pub name: String,
    pub is_directory: bool,
    pub matched_name: bool,
    pub line_matches: Vec<FileSearchLineMatch>,
}

#[napi(object)]
pub struct FileSearchLineMatch {
    pub line: i64,
    pub text: String,
}

// Upper bound for the number of files returned to the renderer. This only
// limits the number of result entries; content matches inside a single file
// do not consume extra slots.
const MAX_RESULTS: usize = 500;
// Allow deep traversal so nested source files are still discoverable. The
// per-directory skip list below keeps the walk from exploding in size.
const MAX_DEPTH: usize = 32;
// Maximum number of matching lines to collect per file.
const MAX_LINE_MATCHES_PER_FILE: usize = 20;
// Skip reading file content larger than this size (8 MB) to avoid heavy I/O.
const MAX_FILE_SIZE_FOR_CONTENT_SEARCH: u64 = 8 * 1024 * 1024;
// Truncate each matched line to avoid shipping huge blobs to the renderer.
const MAX_LINE_LENGTH: usize = 300;

// Directories that are always skipped during traversal. These are build
// artifacts, dependency caches, VCS metadata, or IDE-local state.
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
    ".pytest_cache",
    ".mypy_cache",
    ".tox",
    ".venv",
    "venv",
    "env",
    ".idea",
    ".vscode",
    ".gradle",
    ".terraform",
    "Pods",
    "DerivedData",
];

// Directories that start with a dot are usually hidden config dirs. Some of
// them (like `.github`, `.claude`, `.cursor`) may still contain content the
// user wants to search, so we keep an allowlist that overrides the dot-prefix
// skip rule for directories.
const DOTDIR_ALLOWLIST: &[&str] = &[
    "github",
    "claude",
    "cursor",
    "husky",
    "storybook",
    "devcontainer",
];

// File extensions that are textual and worth scanning for content matches.
// Binary / image / archive / media extensions are excluded automatically.
const TEXTUAL_EXTENSIONS: &[&str] = &[
    "txt", "md", "mdx", "markdown", "rst", "log", "csv", "tsv", "ini", "cfg",
    "conf", "config", "properties", "yaml", "yml", "toml", "json", "jsonc",
    "json5", "xml", "html", "htm", "css", "scss", "sass", "less", "styl",
    "js", "jsx", "ts", "tsx", "mjs", "cjs", "mts", "cts", "vue", "svelte",
    "astro", "py", "rb", "php", "go", "rs", "c", "h", "cpp", "cc", "cxx",
    "hpp", "hxx", "java", "kt", "kts", "swift", "scala", "clj", "cljs",
    "edn", "ex", "exs", "erl", "hrl", "fs", "fsx", "ml", "mli", "nim",
    "dart", "lua", "pl", "pm", "r", "R", "jl", "sh", "bash", "zsh", "fish",
    "ps1", "bat", "cmd", "sql", "graphql", "gql", "proto", "thrift", "sol",
    "vy", "asm", "s", "wasm", "wat", "make", "mk", "tf",
    "tfvars", "hcl", "env", "gitignore", "dockerignore", "npmignore",
    "editorconfig", "prettierrc", "eslintrc", "babelrc", "stylelintrc",
    "wxml", "wxss", "axml", "acss",
];

// Extensions that are known to be binary and must never be scanned for text.
const BINARY_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "bmp", "webp", "ico", "tiff", "tif", "heic",
    "heif", "avif", "psd", "ai", "sketch", "fig", "xcf", "mp3", "wav", "flac",
    "ogg", "opus", "aac", "m4a", "wma", "mp4", "mov", "mkv", "avi", "wmv",
    "flv", "webm", "m4v", "mpg", "mpeg", "3gp", "zip", "tar", "gz", "tgz",
    "bz2", "xz", "zst", "lz", "lzma", "7z", "rar", "iso", "dmg", "pkg",
    "deb", "rpm", "msi", "exe", "dll", "so", "dylib", "a", "lib", "o", "obj",
    "pdb", "ipa", "apk", "aab", "jar", "war", "class", "wasm", "ncb",
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp",
    "sqlite", "sqlite3", "db", "mdb", "lock", "bin", "dat",
];

fn is_textual_extension(ext: &str) -> bool {
    TEXTUAL_EXTENSIONS.contains(&ext)
}

fn is_binary_extension(ext: &str) -> bool {
    BINARY_EXTENSIONS.contains(&ext)
}

// Decide whether a file is worth opening for a content scan. We accept known
// textual extensions, common extensionless build files, and dotfiles; we
// reject known binary extensions. Unknown extensions fall through to the
// binary-null-byte check inside `read_file_lines`.
fn should_read_content(name: &str) -> bool {
    let ext = match Path::new(name).extension() {
        Some(e) => e.to_string_lossy().to_lowercase(),
        None => {
            // Files without an extension: treat common dotfiles and plain
            // names as textual (e.g. "Dockerfile", "Makefile", ".gitignore").
            return matches!(
                name,
                "Dockerfile"
                    | "Makefile"
                    | "makefile"
                    | "Rakefile"
                    | "CMakeLists.txt"
                    | "Gemfile"
                    | "Procfile"
                    | "Brewfile"
                    | "Jenkinsfile"
                    | "Vagrantfile"
            ) || name.starts_with('.');
        }
    };

    if is_binary_extension(&ext) {
        return false;
    }

    if is_textual_extension(&ext) {
        return true;
    }

    // Unknown extension: default to trying to read it; the binary-null check
    // inside read_file_lines will guard us from accidentally shipping garbage.
    true
}

fn read_file_lines(path: &Path) -> Option<Vec<String>> {
    let metadata = match fs::metadata(path) {
        Ok(m) => m,
        Err(_) => return None,
    };

    if !metadata.is_file() {
        return None;
    }

    if metadata.len() > MAX_FILE_SIZE_FOR_CONTENT_SEARCH {
        return None;
    }

    let buffer = match fs::read(path) {
        Ok(b) => b,
        Err(_) => return None,
    };

    // Quick binary check: if the first 8 KB contain a null byte, treat as binary.
    let check_len = buffer.len().min(8192);
    if buffer[..check_len].iter().any(|&b| b == 0) {
        return None;
    }

    let content = String::from_utf8_lossy(&buffer);
    Some(content.lines().map(|l| l.to_string()).collect())
}

pub fn read_directory_entries(dir_path: &str) -> Result<Vec<DirectoryEntry>> {
    let path = Path::new(dir_path);

    if !path.exists() {
        return Err(Error::from_reason(format!(
            "Directory does not exist: {}",
            dir_path
        )));
    }

    if !path.is_dir() {
        return Err(Error::from_reason(format!(
            "Path is not a directory: {}",
            dir_path
        )));
    }

    let entries = fs::read_dir(path).map_err(|e| {
        Error::from_reason(format!(
            "Failed to read directory '{}': {}",
            dir_path, e
        ))
    })?;

    let mut result: Vec<DirectoryEntry> = Vec::new();

    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        let name = entry.file_name().to_string_lossy().to_string();

        let full_path = entry.path();
        let path_string = full_path.to_string_lossy().to_string();

        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };

        let is_directory = metadata.is_dir();
        // Lazy loading: don't read directory contents during listing.
        // Children are loaded on demand when the user expands the directory.
        let size = if is_directory { 0 } else { metadata.len() as i64 };

        result.push(DirectoryEntry {
            name,
            path: path_string,
            is_directory,
            size,
        });
    }

    // Sort: directories first, then by name
    result.sort_by(|a, b| {
        if a.is_directory != b.is_directory {
            return if a.is_directory {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            };
        }
        a.name.cmp(&b.name)
    });

    Ok(result)
}

fn should_skip_dir(name: &str) -> bool {
    if SKIP_DIRS.contains(&name) {
        return true;
    }

    // Allow selected dot-directories through; skip all other dot-prefixed
    // directories to avoid scanning transient caches.
    if name.starts_with('.') {
        let stripped = &name[1..];
        return !DOTDIR_ALLOWLIST.contains(&stripped);
    }

    false
}

// Build the line matches for a single file. Returns an empty vector when the
// file should not be scanned (binary, too large, unreadable, no matches).
fn collect_line_matches(path: &Path, query_lower: &str) -> Vec<FileSearchLineMatch> {
    if !should_read_content(&path.to_string_lossy()) {
        return Vec::new();
    }

    let lines = match read_file_lines(path) {
        Some(l) => l,
        None => return Vec::new(),
    };

    let mut matches: Vec<FileSearchLineMatch> = Vec::new();
    for (idx, line) in lines.iter().enumerate() {
        if matches.len() >= MAX_LINE_MATCHES_PER_FILE {
            break;
        }
        // Case-insensitive substring match. We do a byte-level scan on the
        // lowercased line so unicode case folding is good enough for the
        // common ASCII-heavy source files.
        let lower = line.to_lowercase();
        if lower.contains(query_lower) {
            let truncated: String = if line.len() > MAX_LINE_LENGTH {
                let mut end = MAX_LINE_LENGTH;
                // Avoid splitting in the middle of a UTF-8 continuation byte.
                while end > 0 && !line.is_char_boundary(end) {
                    end -= 1;
                }
                format!("{}...", &line[..end])
            } else {
                line.clone()
            };
            matches.push(FileSearchLineMatch {
                line: (idx as i64) + 1,
                text: truncated,
            });
        }
    }

    matches
}

fn push_result(
    results: &Arc<Mutex<Vec<FileSearchResult>>>,
    counter: &Arc<AtomicUsize>,
    result: FileSearchResult,
) {
    let mut guard = results.lock().unwrap();
    if guard.len() >= MAX_RESULTS {
        return;
    }
    guard.push(result);
    counter.store(guard.len(), Ordering::Relaxed);
}

fn search_dir_recursive(
    root_dir: &Path,
    current_dir: &Path,
    query_lower: &str,
    results: Arc<Mutex<Vec<FileSearchResult>>>,
    counter: Arc<AtomicUsize>,
    depth: usize,
) {
    if counter.load(Ordering::Relaxed) >= MAX_RESULTS || depth > MAX_DEPTH {
        return;
    }

    let entries = match fs::read_dir(current_dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    let mut sub_dirs: Vec<PathBuf> = Vec::new();

    for entry in entries {
        if counter.load(Ordering::Relaxed) >= MAX_RESULTS {
            return;
        }

        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        let name = entry.file_name().to_string_lossy().to_string();

        let full_path = entry.path();

        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            if should_skip_dir(&name) {
                continue;
            }

            if name.to_lowercase().contains(query_lower) {
                let rel = full_path
                    .strip_prefix(root_dir)
                    .unwrap_or(&full_path)
                    .to_string_lossy()
                    .to_string();
                push_result(
                    &results,
                    &counter,
                    FileSearchResult {
                        path: full_path.to_string_lossy().to_string(),
                        relative_path: rel,
                        name: name.clone(),
                        is_directory: true,
                        matched_name: true,
                        line_matches: Vec::new(),
                    },
                );
            }
            sub_dirs.push(full_path);
        } else if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            let name_matched = name.to_lowercase().contains(query_lower);

            // Always scan the file content so we can surface matches even for
            // files whose name does not contain the query (e.g. searching for
            // `context-compaction-message` inside a source file).
            let line_matches = collect_line_matches(&full_path, query_lower);

            if name_matched || !line_matches.is_empty() {
                let rel = full_path
                    .strip_prefix(root_dir)
                    .unwrap_or(&full_path)
                    .to_string_lossy()
                    .to_string();
                push_result(
                    &results,
                    &counter,
                    FileSearchResult {
                        path: full_path.to_string_lossy().to_string(),
                        relative_path: rel,
                        name: name.clone(),
                        is_directory: false,
                        matched_name: name_matched,
                        line_matches,
                    },
                );
            }
        }
    }

    if counter.load(Ordering::Relaxed) >= MAX_RESULTS {
        return;
    }

    // Recurse into sub-directories, collecting handles for parallel execution.
    if !sub_dirs.is_empty() {
        let mut handles = Vec::new();

        for sub_dir in sub_dirs {
            if counter.load(Ordering::Relaxed) >= MAX_RESULTS {
                break;
            }

            let results_clone = Arc::clone(&results);
            let counter_clone = Arc::clone(&counter);
            let root_clone = root_dir.to_path_buf();
            let query_clone = query_lower.to_string();

            handles.push(std::thread::spawn(move || {
                search_dir_recursive(
                    &root_clone,
                    &sub_dir,
                    &query_clone,
                    results_clone,
                    counter_clone,
                    depth + 1,
                );
            }));
        }

        for handle in handles {
            let _ = handle.join();
        }
    }
}

pub fn search_files(root_dir: &str, query: &str) -> Result<Vec<FileSearchResult>> {
    let root_path = Path::new(root_dir);

    if !root_path.exists() {
        return Err(Error::from_reason(format!(
            "Directory does not exist: {}",
            root_dir
        )));
    }

    // Very short queries (single char) would match nearly every file and
    // produce a huge amount of I/O; we require at least two characters so
    // the content scan stays responsive. An empty query returns nothing.
    let trimmed = query.trim();
    if trimmed.len() < 2 {
        return Ok(Vec::new());
    }

    let query_lower = trimmed.to_lowercase();

    let results = Arc::new(Mutex::new(Vec::<FileSearchResult>::new()));
    let counter = Arc::new(AtomicUsize::new(0));

    search_dir_recursive(
        root_path,
        root_path,
        &query_lower,
        Arc::clone(&results),
        Arc::clone(&counter),
        0,
    );

    let mut final_results = results.lock().unwrap().drain(..).collect::<Vec<_>>();

    // Sort: directories first, then files with name matches, then files with
    // content matches, then alphabetical by name. This keeps the most relevant
    // results on top without discarding content-only hits.
    final_results.sort_by(|a, b| {
        if a.is_directory != b.is_directory {
            return if a.is_directory {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            };
        }
        if a.matched_name != b.matched_name {
            return if a.matched_name {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            };
        }
        a.name.cmp(&b.name)
    });
    final_results.truncate(MAX_RESULTS);

    Ok(final_results)
}

fn resolve_workspace_entry(root_path: &str, entry_path: &str) -> Result<(PathBuf, PathBuf)> {
    let root = fs::canonicalize(root_path).map_err(|error| {
        Error::from_reason(format!(
            "Failed to resolve workspace root '{}': {}",
            root_path, error
        ))
    })?;
    let entry = fs::canonicalize(entry_path).map_err(|error| {
        Error::from_reason(format!(
            "Failed to resolve workspace entry '{}': {}",
            entry_path, error
        ))
    })?;

    if entry == root || !entry.starts_with(&root) {
        return Err(Error::from_reason("Workspace entry is outside the workspace root"));
    }

    Ok((root, entry))
}

fn validate_entry_name(name: &str) -> Result<&str> {
    let trimmed = name.trim();
    let is_single_normal_component = matches!(
        Path::new(trimmed).components().next(),
        Some(std::path::Component::Normal(_))
    ) && Path::new(trimmed).components().count() == 1;

    if !is_single_normal_component {
        return Err(Error::from_reason("Entry name must be a single file or directory name"));
    }

    Ok(trimmed)
}

pub fn rename_workspace_entry(root_path: &str, entry_path: &str, new_name: &str) -> Result<()> {
    let (_root, entry) = resolve_workspace_entry(root_path, entry_path)?;
    let name = validate_entry_name(new_name)?;
    let parent = entry.parent().ok_or_else(|| {
        Error::from_reason("Workspace entry does not have a parent directory")
    })?;
    let destination = parent.join(name);

    if destination.exists() {
        return Err(Error::from_reason(format!(
            "A workspace entry named '{}' already exists",
            name
        )));
    }

    fs::rename(&entry, &destination).map_err(|error| {
        Error::from_reason(format!(
            "Failed to rename workspace entry '{}': {}",
            entry.display(), error
        ))
    })
}

pub fn delete_workspace_entry(root_path: &str, entry_path: &str) -> Result<()> {
    let (_root, entry) = resolve_workspace_entry(root_path, entry_path)?;
    let result = if entry.is_dir() {
        fs::remove_dir_all(&entry)
    } else {
        fs::remove_file(&entry)
    };

    result.map_err(|error| {
        Error::from_reason(format!(
            "Failed to delete workspace entry '{}': {}",
            entry.display(), error
        ))
    })
}

pub fn read_file_content(file_path: &str) -> Result<FileContentResult> {
    let path = Path::new(file_path);

    if !path.exists() {
        return Err(Error::from_reason(format!(
            "File does not exist: {}",
            file_path
        )));
    }

    if !path.is_file() {
        return Err(Error::from_reason(format!(
            "Path is not a file: {}",
            file_path
        )));
    }

    let buffer = fs::read(path).map_err(|e| {
        Error::from_reason(format!(
            "Failed to read file '{}': {}",
            file_path, e
        ))
    })?;

    Ok(process_file_content(file_path, buffer))
}
