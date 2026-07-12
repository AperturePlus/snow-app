use std::{fs, io, path::{Path, PathBuf}};

use napi::bindgen_prelude::{Error, Result, Status};
use serde_json::{Map, Value};

const SETTINGS_DIRECTORY: &str = ".snow";
const PERMISSIONS_FILE: &str = "permissions.json";
const ALWAYS_APPROVED_TOOLS_KEY: &str = "alwaysApprovedTools";

pub fn list_always_approved_tools(workspace_path: Option<String>) -> Result<Vec<String>> {
    let project_permissions = workspace_path
        .as_deref()
        .filter(|path| !path.trim().is_empty() && !path.starts_with("ssh://"))
        .map(permissions_path_for_workspace);

    if let Some(path) = project_permissions.as_deref() {
        if path.exists() {
            return read_always_approved_tools(path);
        }
    }

    read_always_approved_tools(&global_permissions_path()?)
}

pub fn add_always_approved_tool(workspace_path: Option<String>, tool_name: String) -> Result<()> {
    let normalized_tool_name = tool_name.trim();
    if normalized_tool_name.is_empty() {
        return Err(Error::new(
            Status::InvalidArg,
            "Tool name is required to persist an approval",
        ));
    }

    let permissions_path = workspace_path
        .as_deref()
        .filter(|path| !path.trim().is_empty() && !path.starts_with("ssh://"))
        .map(permissions_path_for_workspace)
        .unwrap_or(global_permissions_path()?);

    if let Some(parent) = permissions_path.parent() {
        fs::create_dir_all(parent).map_err(|error| file_error("create", parent, error))?;
    }

    let mut permissions = match fs::read_to_string(&permissions_path) {
        Ok(content) => parse_permissions(&content, &permissions_path)?,
        Err(error) if error.kind() == io::ErrorKind::NotFound => Map::new(),
        Err(error) => return Err(file_error("read", &permissions_path, error)),
    };
    let mut approved_tools = get_always_approved_tools(&permissions);

    if !approved_tools.iter().any(|tool| tool == normalized_tool_name) {
        approved_tools.push(normalized_tool_name.to_string());
    }

    permissions.insert(
        ALWAYS_APPROVED_TOOLS_KEY.to_string(),
        Value::Array(approved_tools.into_iter().map(Value::String).collect()),
    );
    let content = serde_json::to_string_pretty(&permissions)
        .map_err(|error| Error::new(Status::GenericFailure, error.to_string()))?;
    fs::write(&permissions_path, format!("{content}\n"))
        .map_err(|error| file_error("write", &permissions_path, error))
}

fn permissions_path_for_workspace(workspace_path: &str) -> PathBuf {
    Path::new(workspace_path)
        .join(SETTINGS_DIRECTORY)
        .join(PERMISSIONS_FILE)
}

fn global_permissions_path() -> Result<PathBuf> {
    dirs_next::home_dir()
        .map(|path| path.join(SETTINGS_DIRECTORY).join(PERMISSIONS_FILE))
        .ok_or_else(|| Error::new(Status::GenericFailure, "Unable to locate the user home directory"))
}

fn read_always_approved_tools(path: &Path) -> Result<Vec<String>> {
    match fs::read_to_string(path) {
        Ok(content) => {
            let permissions = parse_permissions(&content, path)?;
            Ok(get_always_approved_tools(&permissions))
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(file_error("read", path, error)),
    }
}

fn parse_permissions(content: &str, path: &Path) -> Result<Map<String, Value>> {
    serde_json::from_str::<Value>(content)
        .map_err(|error| Error::new(Status::InvalidArg, format!("Invalid permissions JSON at {}: {error}", path.display())))?
        .as_object()
        .cloned()
        .ok_or_else(|| Error::new(Status::InvalidArg, format!("Permissions JSON at {} must be an object", path.display())))
}

fn get_always_approved_tools(permissions: &Map<String, Value>) -> Vec<String> {
    permissions
        .get(ALWAYS_APPROVED_TOOLS_KEY)
        .and_then(Value::as_array)
        .map(|tools| {
            tools
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|tool| !tool.is_empty())
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

fn file_error(action: &str, path: &Path, error: io::Error) -> Error {
    Error::new(
        Status::GenericFailure,
        format!("Unable to {action} {}: {error}", path.display()),
    )
}
