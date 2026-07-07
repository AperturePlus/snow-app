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

const MAX_RESULTS: usize = 200;
const MAX_DEPTH: usize = 10;

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
];

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

fn should_skip(name: &str) -> bool {
    if name.starts_with('.') {
        return true;
    }
    SKIP_DIRS.contains(&name)
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

        if should_skip(&name) {
            continue;
        }

        let full_path = entry.path();

        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            if name.to_lowercase().contains(query_lower) {
                let rel = full_path
                    .strip_prefix(root_dir)
                    .unwrap_or(&full_path)
                    .to_string_lossy()
                    .to_string();
                let mut results = results.lock().unwrap();
                if results.len() < MAX_RESULTS {
                    results.push(FileSearchResult {
                        path: full_path.to_string_lossy().to_string(),
                        relative_path: rel,
                        name: name.clone(),
                        is_directory: true,
                        matched_name: true,
                        line_matches: Vec::new(),
                    });
                    counter.store(results.len(), Ordering::Relaxed);
                }
            }
            sub_dirs.push(full_path);
        } else if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            if name.to_lowercase().contains(query_lower) {
                let rel = full_path
                    .strip_prefix(root_dir)
                    .unwrap_or(&full_path)
                    .to_string_lossy()
                    .to_string();
                let mut results = results.lock().unwrap();
                if results.len() < MAX_RESULTS {
                    results.push(FileSearchResult {
                        path: full_path.to_string_lossy().to_string(),
                        relative_path: rel,
                        name: name.clone(),
                        is_directory: false,
                        matched_name: true,
                        line_matches: Vec::new(),
                    });
                    counter.store(results.len(), Ordering::Relaxed);
                }
            }
        }
    }

    if counter.load(Ordering::Relaxed) >= MAX_RESULTS {
        return;
    }

    // Recurse into sub-directories, collecting handles for parallel execution
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

    let query_lower = query.to_lowercase();

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

    // Sort: directories first, then exact name match, then starts-with, then alphabetical
    final_results.sort_by(|a, b| {
        if a.is_directory != b.is_directory {
            return if a.is_directory {
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
