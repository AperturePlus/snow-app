use napi::bindgen_prelude::*;
use napi_derive::napi;
use serde_json::{json, Value};

use super::builtin::{execute_builtin_tool, get_builtin_tools};
use super::servers::bash::{BashService, BashStreamCallback};
use super::servers::grep::GrepService;
use super::servers::todo::TodoService;

// NOTE: list_mcp_tools 和 call_mcp_tool 的 #[napi] 导出在 exports/api.rs 中，
// 此处仅保留内部函数供 exports 层调用。

#[napi(object)]
pub struct McpToolDefinition {
    pub name: String,
    pub description: String,
    pub input_schema_json: String,
}

#[derive(Clone)]
pub struct McpTool {
    pub server_id: String,
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

impl McpTool {
    pub fn full_name(&self) -> String {
        format!("mcp__{}__{}", self.server_id, self.name)
    }
}

pub fn list_mcp_tools() -> napi::Result<Vec<McpToolDefinition>> {
    let tools = collect_all_mcp_tools()?;

    let definitions = tools
        .iter()
        .map(|tool| McpToolDefinition {
            name: tool.full_name(),
            description: tool.description.clone(),
            input_schema_json: serde_json::to_string(&tool.input_schema)
                .unwrap_or_else(|_| "{}".to_string()),
        })
        .collect();

    Ok(definitions)
}

pub fn collect_all_mcp_tools() -> Result<Vec<McpTool>> {
    let mut tools: Vec<McpTool> = get_builtin_tools();

    let external_configs = load_external_mcp_server_configs()?;
    for config in external_configs {
        if !config.enabled {
            continue;
        }

        let external_tools = load_external_mcp_tools(&config);
        tools.extend(external_tools);
    }

    Ok(tools)
}

pub fn tools_as_openai_chat_json() -> Result<Value> {
    let tools = collect_all_mcp_tools()?;

    let functions: Vec<Value> = tools
        .iter()
        .map(|tool| {
            let sanitized_schema = sanitize_openai_parameters_schema(&tool.input_schema);
            json!({
                "type": "function",
                "function": {
                    "name": tool.full_name(),
                    "description": tool.description,
                    "parameters": sanitized_schema,
                }
            })
        })
        .collect();

    Ok(Value::Array(functions))
}

/// OpenAI Chat Completions API requires the top-level `parameters` schema to be
/// a JSON Schema of `type: "object"`. Some tool definitions may use `oneOf` or
/// omit `type` at the top level, which causes a 400 Bad Request. This function
/// ensures the top-level schema always has `"type": "object"` by removing
/// incompatible top-level keywords (`oneOf`, `anyOf`, `allOf`) and forcing
/// `type` to `"object"` when it is missing or null.
fn sanitize_openai_parameters_schema(schema: &Value) -> Value {
    let mut result = schema.clone();

    if let Some(obj) = result.as_object_mut() {
        // Remove top-level combinators that conflict with a concrete type.
        obj.remove("oneOf");
        obj.remove("anyOf");
        obj.remove("allOf");

        // Force top-level type to "object" if missing or not a string.
        let needs_fix = match obj.get("type") {
            None => true,
            Some(Value::String(s)) => s != "object",
            Some(Value::Null) => true,
            Some(_) => true,
        };
        if needs_fix {
            obj.insert("type".to_string(), Value::String("object".to_string()));
        }
    }

    result
}

pub fn tools_as_anthropic_json() -> Result<Value> {
    let tools = collect_all_mcp_tools()?;

    let tools_json: Vec<Value> = tools
        .iter()
        .map(|tool| {
            json!({
                "name": tool.full_name(),
                "description": tool.description,
                "input_schema": tool.input_schema,
            })
        })
        .collect();

    Ok(Value::Array(tools_json))
}

pub fn tools_as_openai_responses_json() -> Result<Value> {
    let tools = collect_all_mcp_tools()?;

    let tools_json: Vec<Value> = tools
        .iter()
        .map(|tool| {
            json!({
                "type": "function",
                "name": tool.full_name(),
                "description": tool.description,
                "parameters": tool.input_schema,
            })
        })
        .collect();

    Ok(Value::Array(tools_json))
}

pub fn tools_as_gemini_json() -> Result<Value> {
    let tools = collect_all_mcp_tools()?;

    let function_declarations: Vec<Value> = tools
        .iter()
        .map(|tool| {
            json!({
                "name": tool.full_name(),
                "description": tool.description,
                "parameters": tool.input_schema,
            })
        })
        .collect();

    Ok(json!({
        "functionDeclarations": function_declarations
    }))
}

fn load_external_mcp_server_configs() -> Result<Vec<crate::storage::McpServerConfigRecord>> {
    let storage_info = crate::storage::initialize_app_storage()?;
    let database_path = std::path::PathBuf::from(storage_info.database_path);
    crate::storage::services::mcp_server_configs::list_mcp_server_configs(&database_path)
}

fn load_external_mcp_tools(
    config: &crate::storage::McpServerConfigRecord,
) -> Vec<McpTool> {
    let _ = config;
    Vec::new()
}

/// Execute an MCP tool and capture incremental checkpoint state immediately
/// before built-in mutating tools run.
pub async fn call_mcp_tool(
    tool_full_name: String,
    args_json: String,
    checkpoint_ids: Vec<String>,
    checkpoint_work_dir: Option<String>,
    on_chunk: BashStreamCallback,
) -> napi::Result<String> {
    let args = parse_tool_args(&tool_full_name, &args_json)?;

    let checkpoint_ids_after = checkpoint_ids.clone();
    let checkpoint_work_dir_after = checkpoint_work_dir.clone();
    let checkpoint_tool_name = tool_full_name.clone();
    let checkpoint_args = args.clone();
    tokio::task::spawn_blocking(move || {
        capture_checkpoint_before_tool(
            &checkpoint_tool_name,
            &checkpoint_args,
            checkpoint_ids,
            checkpoint_work_dir,
        )
    })
    .await
    .map_err(|error| {
        Error::new(
            Status::GenericFailure,
            format!("Failed to capture checkpoint before tool execution: {error}"),
        )
    })??;

    let result = if tool_full_name == "mcp__bash__terminal-execute" {
        let terminal_result = BashService::new()
            .execute_terminal_stream(&args, on_chunk)
            .await;
        tokio::task::spawn_blocking(move || {
            capture_checkpoint_after_tool(
                checkpoint_ids_after,
                checkpoint_work_dir_after,
            )
        })
        .await
        .map_err(|error| {
            Error::new(
                Status::GenericFailure,
                format!("Failed to capture checkpoint after tool execution: {error}"),
            )
        })??;
        terminal_result?
    } else if tool_full_name == "mcp__grep__search" {
        // GrepService uses async process I/O (ripgrep/grep/findstr).
        let grep_service = GrepService::new();
        grep_service.execute_search(&args).await?
    } else if tool_full_name == "mcp__todo__todo-manage" {
        // TodoService uses async SQLite I/O via spawn_blocking internally,
        // so we call its async entry point directly.
        let todo_service = TodoService::new();
        todo_service.execute_async(&args).await?
    } else {
        tokio::task::spawn_blocking(move || execute_builtin_tool(&tool_full_name, &args))
            .await
            .map_err(|error| {
                Error::new(
                    Status::GenericFailure,
                    format!("Failed to execute MCP tool: {error}"),
                )
            })??
    };

    serde_json::to_string(&result).map_err(|error| {
        Error::new(
            Status::GenericFailure,
            format!("Failed to serialize result: {error}"),
        )
    })
}

fn parse_tool_args(tool_full_name: &str, args_json: &str) -> napi::Result<Value> {
    serde_json::from_str(args_json).map_err(|error| {
        let received = args_json.chars().take(200).collect::<String>();
        let suffix = if args_json.chars().count() > 200 {
            "..."
        } else {
            ""
        };

        Error::new(
            Status::InvalidArg,
            format!(
                "Failed to parse arguments JSON for tool \"{tool_full_name}\": {error}. Received: {received}{suffix}"
            ),
        )
    })
}

fn capture_checkpoint_before_tool(
    tool_full_name: &str,
    args: &Value,
    checkpoint_ids: Vec<String>,
    checkpoint_work_dir: Option<String>,
) -> napi::Result<()> {
    if checkpoint_ids.is_empty() {
        return Ok(());
    }
    let work_dir = checkpoint_work_dir.ok_or_else(|| {
        Error::new(
            Status::InvalidArg,
            "Checkpoint working directory is required".to_string(),
        )
    })?;

    match tool_full_name {
        "mcp__filesystem__replace_edit" | "mcp__filesystem__create" => {
            let file_path = args
                .get("filePath")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    Error::new(
                        Status::InvalidArg,
                        "filePath is required for checkpoint capture".to_string(),
                    )
                })?;
            crate::storage::services::checkpoint::record_checkpoint_file(
                checkpoint_ids,
                work_dir,
                file_path.to_string(),
            )
        }
        "mcp__bash__terminal-execute" => {
            crate::storage::services::checkpoint::record_checkpoint_worktree(
                checkpoint_ids,
                work_dir,
            )
        }
        _ => Ok(()),
    }
}

fn capture_checkpoint_after_tool(
    checkpoint_ids: Vec<String>,
    checkpoint_work_dir: Option<String>,
) -> napi::Result<()> {
    if checkpoint_ids.is_empty() {
        return Ok(());
    }
    let work_dir = checkpoint_work_dir.ok_or_else(|| {
        Error::new(
            Status::InvalidArg,
            "Checkpoint working directory is required".to_string(),
        )
    })?;
    crate::storage::services::checkpoint::record_checkpoint_worktree_after(
        checkpoint_ids,
        work_dir,
    )
}
