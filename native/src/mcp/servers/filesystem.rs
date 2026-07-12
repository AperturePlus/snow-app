use std::fs;
use std::path::Path;

use base64::Engine;
use napi::bindgen_prelude::*;
use serde_json::{json, Value};

use super::super::service::McpService;
use super::super::tools::McpTool;

pub struct FilesystemService;

impl FilesystemService {
    pub fn new() -> Self {
        FilesystemService
    }
}

const SERVER_ID: &str = "filesystem";

impl McpService for FilesystemService {
    fn id(&self) -> &str {
        SERVER_ID
    }

    fn tools(&self) -> Vec<McpTool> {
        vec![
            McpTool {
                server_id: SERVER_ID.to_string(),
                name: "read".to_string(),
                description: "Read file content with line numbers. Supports text files, images, Office documents, and directories.".to_string(),
                input_schema: json!({
                    "oneOf": [
                        {
                            "type": "object",
                            "properties": {
                                "filePath": {
                                    "oneOf": [
                                        { "type": "string" },
                                        { "$ref": "#/definitions/readPathArray" }
                                    ],
                                    "description": "Path to the file to read or directory to list."
                                },
                                "startLine": {
                                    "type": "number",
                                    "description": "Optional starting line number (1-indexed)."
                                },
                                "endLine": {
                                    "type": "number",
                                    "description": "Optional ending line number (1-indexed)."
                                }
                            },
                            "required": ["filePath"]
                        },
                        { "$ref": "#/definitions/readPathArray" }
                    ],
                    "definitions": {
                        "readPathArray": {
                            "type": "array",
                            "items": {
                                "oneOf": [
                                    { "type": "string" },
                                    {
                                        "type": "object",
                                        "properties": {
                                            "path": { "type": "string" },
                                            "startLine": { "type": "number" },
                                            "endLine": { "type": "number" }
                                        },
                                        "required": ["path"]
                                    }
                                ]
                            }
                        }
                    },
                    "description": "Read one path or multiple paths. Accepts either an object with filePath or a root array of path strings or {path, startLine, endLine} objects."
                }),
            },
            McpTool {
                server_id: SERVER_ID.to_string(),
                name: "replace_edit".to_string(),
                description: "Fuzzy search-and-replace editing of file content. Finds searchContent in the file and replaces it with replaceContent.".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "filePath": {
                            "type": "string",
                            "description": "Path to the file to edit."
                        },
                        "searchContent": {
                            "type": "string",
                            "description": "Content to find in the file (raw source text, no line number prefixes)."
                        },
                        "replaceContent": {
                            "type": "string",
                            "description": "New content to replace with."
                        },
                        "occurrence": {
                            "type": "number",
                            "description": "Which match to replace if multiple found (1-indexed, default 1)."
                        }
                    },
                    "required": ["filePath", "searchContent", "replaceContent"]
                }),
            },
            McpTool {
                server_id: SERVER_ID.to_string(),
                name: "create".to_string(),
                description: "Create a new file with content. Automatically creates parent directories if needed.".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "filePath": {
                            "type": "string",
                            "description": "Path where the file should be created."
                        },
                        "content": {
                            "type": "string",
                            "description": "Content to write to the file."
                        },
                        "overwrite": {
                            "type": "boolean",
                            "description": "Whether to overwrite the file if it already exists (default false)."
                        }
                    },
                    "required": ["filePath", "content"]
                }),
            },
        ]
    }

    fn execute(&self, tool_name: &str, args: &Value) -> napi::Result<Value> {
        match tool_name {
            "read" => self.execute_read(args),
            "replace_edit" => self.execute_replace_edit(args),
            "create" => self.execute_create(args),
            _ => Err(Error::new(
                Status::GenericFailure,
                format!(
                    "Unknown tool: \"{}\" for MCP server \"filesystem\". Available tools: [mcp__filesystem__read, mcp__filesystem__replace_edit, mcp__filesystem__create]",
                    tool_name
                ),
            )),
        }
    }
}

impl FilesystemService {
    fn execute_read(&self, args: &Value) -> napi::Result<Value> {
        if let Value::Array(paths) = args {
            return read_paths(paths, None, None);
        }

        let file_path = args.get("filePath").ok_or_else(|| {
            let keys: Vec<String> = args
                .as_object()
                .map(|object| object.keys().cloned().collect())
                .unwrap_or_default();
            Error::new(
                Status::InvalidArg,
                format!(
                    "filePath is required for tool \"mcp__filesystem__read\". Received keys: [{}]. Please provide a valid file path.",
                    keys.join(", ")
                ),
            )
        })?;

        let default_start_line = args.get("startLine").and_then(|value| value.as_u64());
        let default_end_line = args.get("endLine").and_then(|value| value.as_u64());

        match file_path {
            Value::String(path) => read_path(path, default_start_line, default_end_line),
            Value::Array(paths) => read_paths(paths, default_start_line, default_end_line),
            _ => Err(Error::new(
                Status::InvalidArg,
                "filePath must be a string or an array of paths for tool \"mcp__filesystem__read\"."
                    .to_string(),
            )),
        }
    }

    fn execute_replace_edit(&self, args: &Value) -> napi::Result<Value> {
        let file_path = args
            .get("filePath")
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                let keys: Vec<String> = args.as_object().map(|o| o.keys().cloned().collect()).unwrap_or_default();
                Error::new(
                    Status::InvalidArg,
                    format!(
                        "filePath is required for tool \"mcp__filesystem__replace_edit\". Received keys: [{}]. Please provide a valid file path.",
                        keys.join(", ")
                    ),
                )
            })?;

        let search_content = args
            .get("searchContent")
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                Error::new(
                    Status::InvalidArg,
                    "searchContent is required for tool \"mcp__filesystem__replace_edit\". Please provide the content to search for in the file.".to_string(),
                )
            })?;

        let replace_content = args
            .get("replaceContent")
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                Error::new(
                    Status::InvalidArg,
                    "replaceContent is required for tool \"mcp__filesystem__replace_edit\". Please provide the new content to replace with.".to_string(),
                )
            })?;

        let occurrence = args
            .get("occurrence")
            .and_then(|v| v.as_u64())
            .map(|o| o as usize)
            .unwrap_or(1);

        let content = fs::read_to_string(file_path).map_err(|e| {
            Error::new(
                Status::GenericFailure,
                format!("Failed to read file: {}", e),
            )
        })?;

        let matches: Vec<usize> = content
            .match_indices(search_content)
            .map(|(i, _)| i)
            .collect();

        if matches.is_empty() {
            return Err(Error::new(
                Status::GenericFailure,
                "searchContent not found in file".to_string(),
            ));
        }

        let target_idx = matches
            .get(occurrence.saturating_sub(1))
            .copied()
            .ok_or_else(|| {
                Error::new(
                    Status::GenericFailure,
                    format!(
                        "Occurrence {} not found, only {} matches",
                        occurrence,
                        matches.len()
                    ),
                )
            })?;

        let end_idx = target_idx + search_content.len();
        let new_content = format!(
            "{}{}{}",
            &content[..target_idx],
            replace_content,
            &content[end_idx..]
        );

        fs::write(file_path, &new_content).map_err(|e| {
            Error::new(
                Status::GenericFailure,
                format!("Failed to write file: {}", e),
            )
        })?;

        Ok(json!({
            "success": true,
            "matchIndex": target_idx,
            "totalMatches": matches.len(),
            "occurrence": occurrence
        }))
    }

    fn execute_create(&self, args: &Value) -> napi::Result<Value> {
        let file_path = args
            .get("filePath")
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                let keys: Vec<String> = args.as_object().map(|o| o.keys().cloned().collect()).unwrap_or_default();
                Error::new(
                    Status::InvalidArg,
                    format!(
                        "filePath is required for tool \"mcp__filesystem__create\". Received keys: [{}]. Please provide a valid file path.",
                        keys.join(", ")
                    ),
                )
            })?;

        let content = args
            .get("content")
            .and_then(|v| v.as_str())
            .ok_or_else(|| Error::new(Status::InvalidArg, "content is required for tool \"mcp__filesystem__create\". Please provide the content to write to the file.".to_string()))?;

        let overwrite = args
            .get("overwrite")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let path = Path::new(file_path);

        if path.exists() && !overwrite {
            return Err(Error::new(
                Status::GenericFailure,
                format!("File already exists: {}", file_path),
            ));
        }

        if let Some(parent) = path.parent() {
            if !parent.exists() {
                fs::create_dir_all(parent).map_err(|e| {
                    Error::new(
                        Status::GenericFailure,
                        format!("Failed to create directories: {}", e),
                    )
                })?;
            }
        }

        fs::write(path, content).map_err(|e| {
            Error::new(
                Status::GenericFailure,
                format!("Failed to write file: {}", e),
            )
        })?;

        Ok(json!({
            "success": true,
            "path": file_path
        }))
    }
}

fn read_paths(
    paths: &[Value],
    default_start_line: Option<u64>,
    default_end_line: Option<u64>,
) -> napi::Result<Value> {
    let mut files = Vec::with_capacity(paths.len());

    for (index, item) in paths.iter().enumerate() {
        let (path, start_line, end_line) =
            parse_read_path_item(item, default_start_line, default_end_line, index)?;
        let mut result = read_path(path, start_line, end_line)?;
        result["filePath"] = Value::String(path.to_string());
        files.push(result);
    }

    Ok(json!({ "files": files }))
}

fn parse_read_path_item(
    item: &Value,
    default_start_line: Option<u64>,
    default_end_line: Option<u64>,
    index: usize,
) -> napi::Result<(&str, Option<u64>, Option<u64>)> {
    match item {
        Value::String(path) => Ok((path, default_start_line, default_end_line)),
        Value::Object(object) => {
            let path = object.get("path").and_then(Value::as_str).ok_or_else(|| {
                Error::new(
                    Status::InvalidArg,
                    format!("filePath[{}].path must be a non-empty string.", index),
                )
            })?;

            if path.is_empty() {
                return Err(Error::new(
                    Status::InvalidArg,
                    format!("filePath[{}].path must be a non-empty string.", index),
                ));
            }

            Ok((
                path,
                object
                    .get("startLine")
                    .and_then(Value::as_u64)
                    .or(default_start_line),
                object
                    .get("endLine")
                    .and_then(Value::as_u64)
                    .or(default_end_line),
            ))
        }
        _ => Err(Error::new(
            Status::InvalidArg,
            format!(
                "filePath[{}] must be a path string or an object with a path property.",
                index
            ),
        )),
    }
}

fn read_path(
    file_path: &str,
    start_line: Option<u64>,
    end_line: Option<u64>,
) -> napi::Result<Value> {
    if file_path.is_empty() {
        return Err(Error::new(
            Status::InvalidArg,
            "filePath must be a non-empty string for tool \"mcp__filesystem__read\"."
                .to_string(),
        ));
    }

    let path = Path::new(file_path);

    if path.is_dir() {
        let entries = fs::read_dir(path).map_err(|error| {
            Error::new(
                Status::GenericFailure,
                format!("Failed to read directory: {}", error),
            )
        })?;

        let mut items: Vec<String> = Vec::new();
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            let prefix = if entry.path().is_dir() { "/" } else { "" };
            items.push(format!("{}{}", name, prefix));
        }
        items.sort();

        return Ok(json!({
            "content": items.join("\n")
        }));
    }

    if is_image_file(path) {
        let data_url = read_image_as_data_url(path)?;
        return Ok(json!({
            "content": format!("@@image:{}@@", data_url),
            "mediaType": image_media_type(path),
            "isImage": true
        }));
    }

    let content = fs::read_to_string(path).map_err(|error| {
        Error::new(
            Status::GenericFailure,
            format!("Failed to read file: {}", error),
        )
    })?;

    let lines: Vec<&str> = content.lines().collect();
    let total_lines = lines.len();
    let start = start_line
        .map(|line| line as usize)
        .unwrap_or(1)
        .saturating_sub(1);
    let end = end_line
        .map(|line| line as usize)
        .unwrap_or(total_lines)
        .min(total_lines);

    if start >= total_lines {
        return Ok(json!({
            "content": "",
            "totalLines": total_lines
        }));
    }

    let selected: Vec<String> = lines[start..end]
        .iter()
        .enumerate()
        .map(|(index, line)| format!("{:>6}: {}", start + index + 1, line))
        .collect();

    Ok(json!({
        "content": selected.join("\n"),
        "totalLines": total_lines,
        "startLine": start + 1,
        "endLine": end
    }))
}

fn is_image_file(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|ext| ext.to_str())
            .map(str::to_lowercase)
            .as_deref(),
        Some("png")
            | Some("jpg")
            | Some("jpeg")
            | Some("gif")
            | Some("webp")
            | Some("bmp")
            | Some("svg")
    )
}

fn image_media_type(path: &Path) -> String {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(str::to_lowercase)
        .as_deref()
    {
        Some("png") => "image/png".to_string(),
        Some("jpg") | Some("jpeg") => "image/jpeg".to_string(),
        Some("gif") => "image/gif".to_string(),
        Some("webp") => "image/webp".to_string(),
        Some("bmp") => "image/bmp".to_string(),
        Some("svg") => "image/svg+xml".to_string(),
        _ => "application/octet-stream".to_string(),
    }
}

fn read_image_as_data_url(path: &Path) -> napi::Result<String> {
    let bytes = fs::read(path).map_err(|e| {
        Error::new(
            Status::GenericFailure,
            format!("Failed to read image file: {}", e),
        )
    })?;

    if bytes.is_empty() {
        return Err(Error::new(
            Status::GenericFailure,
            "Image file is empty".to_string(),
        ));
    }

    let media_type = image_media_type(path);
    let data = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{};base64,{}", media_type, data))
}