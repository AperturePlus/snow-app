use std::fs;
use std::path::Path;

use napi::bindgen_prelude::*;
use napi_derive::napi;

#[napi(object)]
pub struct DirectoryEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub size: i64,
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
