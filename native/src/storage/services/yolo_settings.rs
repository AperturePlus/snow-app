use std::{fs, io, path::{Path, PathBuf}};

use napi::bindgen_prelude::{Error, Result, Status};
use serde_json::{Map, Value};

const SETTINGS_DIRECTORY: &str = ".snow";
const SETTINGS_FILE: &str = "settings.json";

pub fn get_yolo_mode(workspace_path: Option<String>) -> Result<bool> {
    let project_settings = workspace_path
        .as_deref()
        .filter(|path| !path.trim().is_empty() && !path.starts_with("ssh://"))
        .map(settings_path_for_workspace);

    if let Some(path) = project_settings.as_deref() {
        if path.exists() {
            return read_yolo_mode(path);
        }
    }

    read_yolo_mode(&global_settings_path()?)
}

pub fn set_yolo_mode(workspace_path: Option<String>, enabled: bool) -> Result<()> {
    let settings_path = workspace_path
        .as_deref()
        .filter(|path| !path.trim().is_empty() && !path.starts_with("ssh://"))
        .map(settings_path_for_workspace)
        .unwrap_or(global_settings_path()?);

    write_yolo_mode(&settings_path, enabled)
}

fn settings_path_for_workspace(workspace_path: &str) -> PathBuf {
    Path::new(workspace_path)
        .join(SETTINGS_DIRECTORY)
        .join(SETTINGS_FILE)
}

fn global_settings_path() -> Result<PathBuf> {
    dirs_next::home_dir()
        .map(|path| path.join(SETTINGS_DIRECTORY).join(SETTINGS_FILE))
        .ok_or_else(|| Error::new(Status::GenericFailure, "Unable to locate the user home directory"))
}

fn read_yolo_mode(path: &Path) -> Result<bool> {
    match fs::read_to_string(path) {
        Ok(content) => {
            let settings = parse_settings(&content, path)?;
            Ok(settings
                .get("yoloMode")
                .and_then(Value::as_bool)
                .unwrap_or(false))
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(file_error("read", path, error)),
    }
}

fn write_yolo_mode(path: &Path, enabled: bool) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| file_error("create", parent, error))?;
    }

    let mut settings = match fs::read_to_string(path) {
        Ok(content) => parse_settings(&content, path)?,
        Err(error) if error.kind() == io::ErrorKind::NotFound => Map::new(),
        Err(error) => return Err(file_error("read", path, error)),
    };

    settings.insert("yoloMode".to_string(), Value::Bool(enabled));
    let content = serde_json::to_string_pretty(&settings)
        .map_err(|error| Error::new(Status::GenericFailure, error.to_string()))?;
    fs::write(path, format!("{content}\n")).map_err(|error| file_error("write", path, error))
}

fn parse_settings(content: &str, path: &Path) -> Result<Map<String, Value>> {
    serde_json::from_str::<Value>(content)
        .map_err(|error| Error::new(Status::InvalidArg, format!("Invalid settings JSON at {}: {error}", path.display())))?
        .as_object()
        .cloned()
        .ok_or_else(|| Error::new(Status::InvalidArg, format!("Settings JSON at {} must be an object", path.display())))
}

fn file_error(action: &str, path: &Path, error: io::Error) -> Error {
    Error::new(
        Status::GenericFailure,
        format!("Unable to {action} {}: {error}", path.display()),
    )
}
