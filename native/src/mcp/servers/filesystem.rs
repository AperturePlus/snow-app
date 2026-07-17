use std::fs;
use std::path::Path;

use base64::Engine;
use napi::bindgen_prelude::*;
use serde_json::{json, Value};
use similar::TextDiff;

use super::super::service::McpService;
use super::super::tools::McpTool;

/// 模糊匹配的最低相似度阈值（0.0 ~ 1.0）。
/// 当 searchContent 与文件中某段内容相似度达到此值时，视为匹配成功。
const FUZZY_MATCH_THRESHOLD: f64 = 0.75;

/// 当 searchContent 不含行号前缀但文件内容含行号前缀（或反之）时，
/// 逐行剥离前缀后重试匹配。
const LINE_PREFIX_REGEX: &str = r"^\s*\d+[\s\|:]*";

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
                            "oneOf": [
                                { "type": "string" },
                                {
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
                            ],
                            "description": "Path to the file to read or directory to list. Can be a single path string, an array of path strings, or an array of {path, startLine, endLine} objects."
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
                description: "Fuzzy search-and-replace editing. Finds searchContent in the file and replaces it with replaceContent. IMPORTANT: searchContent must be COPIED EXACTLY from the file - do NOT include line number prefixes (like \"42:\") that appear in read output, do NOT retype or paraphrase. Copy the raw source text verbatim. If the exact text is not found, a fuzzy match is attempted; on failure the error includes the closest matching region to help you correct your searchContent.".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "filePath": {
                            "type": "string",
                            "description": "Path to the file to edit."
                        },
                        "searchContent": {
                            "type": "string",
                            "description": "The EXACT raw source text to find in the file. Do NOT include line number prefixes from read output. Copy verbatim from the file content."
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
                description: "Create a new file with content. Automatically creates parent directories if needed. If the file already exists, an error is returned with the current file size and line count - use overwrite=true to replace it, or use replace_edit instead to modify the existing file.".to_string(),
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
            Value::String(path) => {
                if let Some(arr) = try_parse_as_json_array(path) {
                    return read_paths(&arr, default_start_line, default_end_line);
                }
                read_path(path, default_start_line, default_end_line)
            }
            Value::Array(paths) => read_paths(paths, default_start_line, default_end_line),
            _ => Err(Error::new(
                Status::InvalidArg,
                "filePath must be a string or an array of paths for tool \"mcp__filesystem__read\"."
                    .to_string(),
            )),
        }
    }

    fn execute_replace_edit(&self, args: &Value) -> napi::Result<Value> {
        let file_path = normalize_path(
            args
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
                })?,
        );

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

        let content = fs::read_to_string(&file_path).map_err(|e| {
            Error::new(
                Status::GenericFailure,
                format!("Failed to read file: {} (path: {})", e, file_path),
            )
        })?;

        // Step 1: Try exact match
        let matches: Vec<usize> = content
            .match_indices(search_content)
            .map(|(i, _)| i)
            .collect();

        if !matches.is_empty() {
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

            fs::write(&file_path, &new_content).map_err(|e| {
                Error::new(
                    Status::GenericFailure,
                    format!("Failed to write file: {} (path: {})", e, file_path),
                )
            })?;

            return Ok(json!({
                "success": true,
                "matchIndex": target_idx,
                "totalMatches": matches.len(),
                "occurrence": occurrence,
                "matchType": "exact"
            }));
        }

        // Step 2: Try with line number prefixes stripped from searchContent
        // (AI often copies content from read output which includes line number prefixes)
        if let Some(stripped) = try_strip_line_prefixes(search_content) {
            let stripped_matches: Vec<usize> = content
                .match_indices(&stripped)
                .map(|(i, _)| i)
                .collect();

            if !stripped_matches.is_empty() {
                let target_idx = stripped_matches
                    .get(occurrence.saturating_sub(1))
                    .copied()
                    .ok_or_else(|| {
                        Error::new(
                            Status::GenericFailure,
                            format!(
                                "Occurrence {} not found after stripping line prefixes, only {} matches",
                                occurrence,
                                stripped_matches.len()
                            ),
                        )
                    })?;

                let end_idx = target_idx + stripped.len();
                let new_content = format!(
                    "{}{}{}",
                    &content[..target_idx],
                    replace_content,
                    &content[end_idx..]
                );

                fs::write(&file_path, &new_content).map_err(|e| {
                    Error::new(
                        Status::GenericFailure,
                        format!("Failed to write file: {} (path: {})", e, file_path),
                    )
                })?;

                return Ok(json!({
                    "success": true,
                    "matchIndex": target_idx,
                    "totalMatches": stripped_matches.len(),
                    "occurrence": occurrence,
                    "matchType": "exact_after_stripping_prefixes"
                }));
            }
        }

        // Step 3: Try fuzzy line-based matching
        let content_lines: Vec<&str> = content.lines().collect();
        let total_lines = content_lines.len();

        // Skip fuzzy matching for very large files to avoid blocking
        if total_lines <= 5000 {
            if let Some((start_line, end_line, similarity)) =
                find_best_line_match(search_content, &content)
            {
                if similarity >= FUZZY_MATCH_THRESHOLD {
                    let (start_byte, end_byte) =
                        line_range_to_byte_range(&content, start_line, end_line);
                    let new_content = format!(
                        "{}{}{}",
                        &content[..start_byte],
                        replace_content,
                        &content[end_byte..]
                    );

                    fs::write(&file_path, &new_content).map_err(|e| {
                        Error::new(
                            Status::GenericFailure,
                            format!("Failed to write file: {} (path: {})", e, file_path),
                        )
                    })?;

                    return Ok(json!({
                        "success": true,
                        "matchType": "fuzzy",
                        "similarity": similarity,
                        "matchedLineStart": start_line + 1,
                        "matchedLineEnd": end_line,
                        "totalLines": total_lines
                    }));
                }
            }
        }

        // Step 4: All matches failed - return helpful error with closest match context
        let error_msg =
            build_search_not_found_error(search_content, &content, &file_path, total_lines);

        Err(Error::new(Status::GenericFailure, error_msg))
    }

    fn execute_create(&self, args: &Value) -> napi::Result<Value> {
        let file_path = normalize_path(
            args
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
                })?,
        );

        let content = args
            .get("content")
            .and_then(|v| v.as_str())
            .ok_or_else(|| Error::new(Status::InvalidArg, "content is required for tool \"mcp__filesystem__create\". Please provide the content to write to the file.".to_string()))?;

        let overwrite = args
            .get("overwrite")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let path = Path::new(&file_path);

        if path.exists() && !overwrite {
            let file_size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
            let line_count = fs::read_to_string(path)
                .map(|c| c.lines().count())
                .unwrap_or(0);
            return Err(Error::new(
                Status::GenericFailure,
                format!(
                    "File already exists: {} ({} bytes, {} lines). To overwrite this file, set overwrite=true. To modify the existing file, use mcp__filesystem__replace_edit instead.",
                    file_path, file_size, line_count
                ),
            ));
        }

        if let Some(parent) = path.parent() {
            if !parent.exists() {
                fs::create_dir_all(parent).map_err(|e| {
                    Error::new(
                        Status::GenericFailure,
                        format!("Failed to create directories: {} (path: {})", e, file_path),
                    )
                })?;
            }
        }

        fs::write(path, content).map_err(|e| {
            Error::new(
                Status::GenericFailure,
                format!("Failed to write file: {} (path: {})", e, file_path),
            )
        })?;

        let byte_count = content.len();
        let line_count = content.lines().count();

        Ok(json!({
            "success": true,
            "path": file_path,
            "bytes": byte_count,
            "lines": line_count
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
        let mut result = read_path(&path, start_line, end_line)?;
        result["filePath"] = Value::String(path);
        files.push(result);
    }

    Ok(json!({ "files": files }))
}

fn parse_read_path_item(
    item: &Value,
    default_start_line: Option<u64>,
    default_end_line: Option<u64>,
    index: usize,
) -> napi::Result<(String, Option<u64>, Option<u64>)> {
    match item {
        Value::String(path) => {
            let normalized = normalize_path(path);
            if normalized.is_empty() {
                return Err(Error::new(
                    Status::InvalidArg,
                    format!("filePath[{}] must be a non-empty string.", index),
                ));
            }
            Ok((normalized, default_start_line, default_end_line))
        }
        Value::Object(object) => {
            let path = object.get("path").and_then(Value::as_str).ok_or_else(|| {
                Error::new(
                    Status::InvalidArg,
                    format!("filePath[{}].path must be a non-empty string.", index),
                )
            })?;

            let normalized = normalize_path(path);
            if normalized.is_empty() {
                return Err(Error::new(
                    Status::InvalidArg,
                    format!("filePath[{}].path must be a non-empty string.", index),
                ));
            }

            Ok((
                normalized,
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

/// 如果 searchContent 的每一行都以行号前缀开头（如 "42: " 或 "  10| "），
/// 则剥离所有行号前缀，返回纯内容。否则返回 None。
/// 这处理 AI 从 read 输出中复制了行号前缀的情况。
fn try_strip_line_prefixes(text: &str) -> Option<String> {
    let re = regex::Regex::new(LINE_PREFIX_REGEX).ok()?;

    let lines: Vec<&str> = text.lines().collect();
    if lines.is_empty() {
        return None;
    }

    // Check if at least 60% of non-empty lines have a line number prefix
    let non_empty_count = lines.iter().filter(|l| !l.trim().is_empty()).count();
    if non_empty_count == 0 {
        return None;
    }

    let prefixed_count = lines
        .iter()
        .filter(|l| !l.trim().is_empty() && re.is_match(l))
        .count();

    let ratio = prefixed_count as f64 / non_empty_count as f64;
    if ratio < 0.6 {
        return None;
    }

    // Strip prefixes from all lines
    let stripped_lines: Vec<String> = lines
        .iter()
        .map(|line| {
            if line.trim().is_empty() {
                line.to_string()
            } else {
                re.replace(line, "").to_string()
            }
        })
        .collect();

    let result = stripped_lines.join("\n");

    // Only return if it's actually different from the original
    if result != text {
        Some(result)
    } else {
        None
    }
}

/// 计算两个字符串之间的相似度（0.0 ~ 1.0），基于 TextDiff 的 ratio。
fn compute_similarity(a: &str, b: &str) -> f64 {
    if a.is_empty() && b.is_empty() {
        return 1.0;
    }
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let diff = TextDiff::from_lines(a, b);
    diff.ratio() as f64
}

/// 在文件内容中，按行滑动窗口查找与 searchContent 最相似的区间。
/// 返回 (起始行号, 结束行号(不含), 相似度)。
/// 起始行号和结束行号都是 0-indexed。
fn find_best_line_match(
    search_content: &str,
    file_content: &str,
) -> Option<(usize, usize, f64)> {
    let search_lines: Vec<&str> = search_content.lines().collect();
    let file_lines: Vec<&str> = file_content.lines().collect();

    if search_lines.is_empty() || file_lines.is_empty() {
        return None;
    }

    let search_line_count = search_lines.len();
    let max_window = search_line_count + 5; // Allow some slack
    let min_window = if search_line_count > 5 {
        search_line_count - 5
    } else {
        1
    };

    let mut best_similarity: f64 = 0.0;
    let mut best_start: usize = 0;
    let mut best_end: usize = 0;

    // Slide window over file lines
    for window_size in min_window..=max_window {
        if window_size > file_lines.len() {
            break;
        }

        for start in 0..=(file_lines.len().saturating_sub(window_size)) {
            let end = start + window_size;
            let file_slice = file_lines[start..end].join("\n");
            let similarity = compute_similarity(search_content, &file_slice);

            if similarity > best_similarity {
                best_similarity = similarity;
                best_start = start;
                best_end = end;
            }

            // Early exit if we found a very good match
            if similarity > 0.95 {
                return Some((best_start, best_end, best_similarity));
            }
        }
    }

    if best_similarity > 0.0 {
        Some((best_start, best_end, best_similarity))
    } else {
        None
    }
}

/// 将行号范围 (0-indexed, end exclusive) 转换为字节范围。
fn line_range_to_byte_range(content: &str, start_line: usize, end_line: usize) -> (usize, usize) {
    let mut current_line = 0;
    let mut start_byte = 0;
    let mut end_byte = content.len();

    for (byte_idx, ch) in content.char_indices() {
        if current_line == start_line {
            start_byte = byte_idx;
        }
        if ch == '\n' {
            current_line += 1;
            if current_line == end_line {
                end_byte = byte_idx + 1; // Include the newline
                break;
            }
        }
    }

    // Handle the case where end_line is the last line (no trailing newline)
    if end_byte == content.len() && current_line < end_line {
        end_byte = content.len();
    }

    (start_byte, end_byte)
}

/// 构建 "searchContent not found" 的详细错误信息，包含最相似区间的上下文。
fn build_search_not_found_error(
    search_content: &str,
    file_content: &str,
    file_path: &str,
    total_lines: usize,
) -> String {
    let search_lines = search_content.lines().count();
    let search_preview: String = search_content
        .chars()
        .take(200)
        .collect::<String>()
        .replace('\n', "\\n");

    // Try to find the closest match for helpful context
    if let Some((start_line, end_line, similarity)) =
        find_best_line_match(search_content, file_content)
    {
        let file_lines: Vec<&str> = file_content.lines().collect();
        let context_start = start_line.saturating_sub(2);
        let context_end = (end_line + 2).min(file_lines.len());

        let context: Vec<String> = (context_start..context_end)
            .map(|i| {
                let marker = if i >= start_line && i < end_line {
                    ">>>"
                } else {
                    "   "
                };
                format!("{} {:>6}: {}", marker, i + 1, file_lines[i])
            })
            .collect();

        let similarity_percent = (similarity * 100.0) as u32;

        return format!(
            "searchContent not found in file (exact match failed).\n\n\
             File: {} ({} lines total)\n\
             searchContent: {} lines, preview: \"{}\"\n\n\
             Closest matching region (similarity: {}%, lines {}-{}):\n\
             {}\n\n\
             The searchContent does not match any part of the file exactly. Common causes:\n\
             1. searchContent was copied from read output and includes line number prefixes (e.g. \"42:...\") - remove them.\n\
             2. searchContent has been paraphrased or retyped instead of copied verbatim.\n\
             3. The file was modified since it was last read.\n\
             Please re-read the file with mcp__filesystem__read and copy the EXACT raw source text as searchContent.",
            file_path,
            total_lines,
            search_lines,
            search_preview,
            similarity_percent,
            start_line + 1,
            end_line,
            context.join("\n")
        );
    }

    format!(
        "searchContent not found in file (exact match failed).\n\n\
         File: {} ({} lines total)\n\
         searchContent: {} lines, preview: \"{}\"\n\n\
         No similar content found in the file. The file may have been modified since it was last read.\n\
         Please re-read the file with mcp__filesystem__read and copy the EXACT raw source text as searchContent.",
        file_path,
        total_lines,
        search_lines,
        search_preview
    )
}

fn normalize_path(path: &str) -> String {
    let mut normalized = path.trim().to_string();
    normalized = normalized.replace('\0', "");
    if normalized.starts_with('\u{FEFF}') {
        normalized = normalized.trim_start_matches('\u{FEFF}').to_string();
    }
    normalized
}

fn try_parse_as_json_array(s: &str) -> Option<Vec<Value>> {
    let trimmed = s.trim();
    if !trimmed.starts_with('[') || !trimmed.ends_with(']') {
        return None;
    }
    serde_json::from_str::<Vec<Value>>(trimmed).ok()
}

fn read_path(
    file_path: &str,
    start_line: Option<u64>,
    end_line: Option<u64>,
) -> napi::Result<Value> {
    let file_path = normalize_path(file_path);

    if file_path.is_empty() {
        return Err(Error::new(
            Status::InvalidArg,
            "filePath must be a non-empty string for tool \"mcp__filesystem__read\"."
                .to_string(),
        ));
    }

    let path = Path::new(&file_path);

    if path.is_dir() {
        let entries = fs::read_dir(path).map_err(|error| {
            Error::new(
                Status::GenericFailure,
                format!("Failed to read directory: {} (path: {})", error, file_path),
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
            format!("Failed to read file: {} (path: {})", error, file_path),
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