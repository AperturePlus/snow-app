use napi::bindgen_prelude::*;
use napi_derive::napi;
use serde_json::{json, Value};

use super::builtin::{execute_builtin_tool, get_builtin_tools};
use super::servers::bash::{BashService, BashStreamCallback};
use super::servers::browser::{BrowserCommandCallback, BrowserService};
use super::servers::grep::GrepService;
use super::servers::todo::TodoService;
use super::servers::user_interaction::{UserInteractionService, UserQuestionCallback};
use super::servers::websearch::WebSearchService;

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
            let sanitized_schema = sanitize_tool_input_schema(&tool.input_schema);
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

/// Tool APIs require the root input schema to describe an object. Some
/// compatible gateways reject root `oneOf`/`anyOf`/`allOf` combinators when a
/// branch does not explicitly declare an object, even if the root has
/// `type: "object"`. Keep nested constraints intact, but remove root
/// combinators and always emit an object schema. Runtime tool validation still
/// enforces cross-field requirements that cannot be represented at the root.
fn sanitize_tool_input_schema(schema: &Value) -> Value {
    let mut result = schema.as_object().cloned().unwrap_or_default();

    result.remove("oneOf");
    result.remove("anyOf");
    result.remove("allOf");
    result.insert("type".to_string(), Value::String("object".to_string()));

    Value::Object(result)
}

pub fn tools_as_anthropic_json() -> Result<Value> {
    let tools = collect_all_mcp_tools()?;

    let tools_json: Vec<Value> = tools
        .iter()
        .map(|tool| {
            let sanitized_schema = sanitize_tool_input_schema(&tool.input_schema);
            json!({
                "name": tool.full_name(),
                "description": tool.description,
                "input_schema": sanitized_schema,
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
pub async fn call_mcp_tool(
    tool_full_name: String,
    args_json: String,
    checkpoint_ids: Vec<String>,
    checkpoint_work_dir: Option<String>,
    sensitive_authorization_token: Option<String>,
    on_chunk: BashStreamCallback,
    on_browser_command: BrowserCommandCallback,
    on_user_question: UserQuestionCallback,
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
            .execute_terminal_stream(
                &args,
                sensitive_authorization_token.as_deref(),
                on_chunk,
            )
            .await;
        tokio::task::spawn_blocking(move || {
            capture_checkpoint_after_tool(checkpoint_ids_after, checkpoint_work_dir_after)
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
        GrepService::new().execute_search(&args).await?
    } else if tool_full_name == "mcp__todo__todo-manage" {
        TodoService::new().execute_async(&args).await?
    } else if tool_full_name == "mcp__websearch__websearch-search" {
        WebSearchService::new().execute_search(&args).await?
    } else if tool_full_name == "mcp__websearch__websearch-fetch" {
        WebSearchService::new().execute_fetch(&args).await?
    } else if let Some(tool_name) = tool_full_name.strip_prefix("mcp__browser__") {
        BrowserService::new()
            .execute_async(tool_name, &args, &on_browser_command)
            .await?
    } else if tool_full_name == "mcp__user-interaction__askUserQuestion" {
        UserInteractionService::new()
            .execute_async(&args, &on_user_question)
            .await?
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_tool_input_schema_removes_only_root_combinators() {
        let schema = json!({
            "type": "object",
            "properties": {
                "target": {
                    "oneOf": [
                        { "type": "string" },
                        { "type": "number" }
                    ]
                }
            },
            "anyOf": [
                { "required": ["selector"] },
                { "type": "string" }
            ],
            "oneOf": [
                { "type": "object" },
                { "type": "string" }
            ],
            "allOf": [
                { "type": "object" }
            ]
        });

        let sanitized = sanitize_tool_input_schema(&schema);

        assert_eq!(sanitized.get("type").and_then(Value::as_str), Some("object"));
        assert!(sanitized.get("anyOf").is_none());
        assert!(sanitized.get("oneOf").is_none());
        assert!(sanitized.get("allOf").is_none());
        assert!(sanitized.pointer("/properties/target/oneOf").is_some());
    }

    #[test]
    fn sanitize_tool_input_schema_converts_non_object_root() {
        let sanitized = sanitize_tool_input_schema(&json!([
            { "type": "object" },
            { "type": "string" }
        ]));

        assert_eq!(sanitized, json!({ "type": "object" }));
    }
}
