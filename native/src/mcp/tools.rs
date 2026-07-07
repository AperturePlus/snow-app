use napi::bindgen_prelude::*;
use napi_derive::napi;
use serde_json::{json, Value};

use super::builtin::{execute_builtin_tool, get_builtin_tools};

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
            json!({
                "type": "function",
                "function": {
                    "name": tool.full_name(),
                    "description": tool.description,
                    "parameters": tool.input_schema,
                }
            })
        })
        .collect();

    Ok(Value::Array(functions))
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

/// 执行 MCP 工具调用。
///
/// 参数 `tool_full_name` 格式为 `mcp__{server_id}__{tool_name}`，
/// 例如 `mcp__filesystem__read`。
///
/// 对于内置服务（如 filesystem），直接在 Rust 侧执行；
/// 对于外部 MCP 服务（未来支持），将转发到对应的 MCP 服务器。
pub fn call_mcp_tool(tool_full_name: String, args_json: String) -> napi::Result<String> {
    let args: Value = serde_json::from_str(&args_json).unwrap_or_else(|_| json!({}));

    // 尝试内置工具执行
    let result = execute_builtin_tool(&tool_full_name, &args)?;

    serde_json::to_string(&result).map_err(|e| {
        Error::new(
            Status::GenericFailure,
            format!("Failed to serialize result: {}", e),
        )
    })
}
