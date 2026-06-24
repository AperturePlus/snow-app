use std::fs;
use std::path::Path;

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
                    "type": "object",
                    "properties": {
                        "filePath": {
                            "type": "string",
                            "description": "Path to the file to read or directory to list. Can be a single path, array of paths, or array of {path, startLine, endLine} objects."
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
                format!("Unknown tool: {}", tool_name),
            )),
        }
    }
}

impl FilesystemService {
    fn execute_read(&self, args: &Value) -> napi::Result<Value> {
        let file_path = args
            .get("filePath")
            .and_then(|v| v.as_str())
            .ok_or_else(|| Error::new(Status::InvalidArg, "filePath is required".to_string()))?;

        let start_line = args.get("startLine").and_then(|v| v.as_u64());
        let end_line = args.get("endLine").and_then(|v| v.as_u64());

        let path = Path::new(file_path);

        if path.is_dir() {
            let entries = fs::read_dir(path).map_err(|e| {
                Error::new(
                    Status::GenericFailure,
                    format!("Failed to read directory: {}", e),
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

        let content = fs::read_to_string(path).map_err(|e| {
            Error::new(
                Status::GenericFailure,
                format!("Failed to read file: {}", e),
            )
        })?;

        let lines: Vec<&str> = content.lines().collect();
        let total_lines = lines.len();

        let start = start_line.map(|s| s as usize).unwrap_or(1).saturating_sub(1);
        let end = end_line
            .map(|e| e as usize)
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
            .map(|(i, line)| format!("{:>6}: {}", start + i + 1, line))
            .collect();

        Ok(json!({
            "content": selected.join("\n"),
            "totalLines": total_lines,
            "startLine": start + 1,
            "endLine": end
        }))
    }

    fn execute_replace_edit(&self, args: &Value) -> napi::Result<Value> {
        let file_path = args
            .get("filePath")
            .and_then(|v| v.as_str())
            .ok_or_else(|| Error::new(Status::InvalidArg, "filePath is required".to_string()))?;

        let search_content = args
            .get("searchContent")
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                Error::new(
                    Status::InvalidArg,
                    "searchContent is required".to_string(),
                )
            })?;

        let replace_content = args
            .get("replaceContent")
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                Error::new(
                    Status::InvalidArg,
                    "replaceContent is required".to_string(),
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
            .ok_or_else(|| Error::new(Status::InvalidArg, "filePath is required".to_string()))?;

        let content = args
            .get("content")
            .and_then(|v| v.as_str())
            .ok_or_else(|| Error::new(Status::InvalidArg, "content is required".to_string()))?;

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
