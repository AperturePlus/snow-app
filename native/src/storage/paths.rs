use std::path::{Path, PathBuf};

use napi::bindgen_prelude::*;

const APP_STORAGE_DIR_NAME: &str = ".snowapp";
const APP_DATABASE_FILE_NAME: &str = "snowapp.db";

pub fn app_storage_dir() -> Result<PathBuf> {
    let home_dir = dirs_next::home_dir().ok_or_else(|| {
        Error::from_reason("Failed to resolve the current user's home directory".to_string())
    })?;

    Ok(home_dir.join(APP_STORAGE_DIR_NAME))
}

pub fn database_file_path(storage_dir: &Path) -> PathBuf {
    storage_dir.join(APP_DATABASE_FILE_NAME)
}
