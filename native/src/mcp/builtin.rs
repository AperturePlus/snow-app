use std::collections::HashMap;
use std::sync::Arc;

use napi::bindgen_prelude::*;
use serde_json::Value;

use super::service::McpService;
use super::servers::bash::BashService;
use super::servers::filesystem::FilesystemService;
use super::servers::grep::GrepService;
use super::servers::todo::TodoService;
use super::tools::McpTool;

/// 注册所有内置 MCP 服务，返回 server_id -> service 的映射。
pub fn builtin_services() -> HashMap<String, Arc<dyn McpService>> {
    let services: Vec<Arc<dyn McpService>> = vec![
        Arc::new(FilesystemService::new()),
        Arc::new(BashService::new()),
        Arc::new(TodoService::new()),
        Arc::new(GrepService::new()),
    ];
    services
        .into_iter()
        .map(|s| (s.id().to_string(), s))
        .collect()
}

/// 返回所有内置服务的工具定义。
pub fn get_builtin_tools() -> Vec<McpTool> {
    let services = builtin_services();
    let mut tools = Vec::new();
    for (_, service) in services {
        tools.extend(service.tools());
    }
    tools
}

/// 根据完整工具名（如 `mcp__filesystem__read`）执行对应的内置工具。
///
/// 格式: `mcp__{server_id}__{tool_name}`
pub fn execute_builtin_tool(full_name: &str, args: &Value) -> napi::Result<Value> {
    let parts: Vec<&str> = full_name.splitn(3, "__").collect();
    if parts.len() != 3 || parts[0] != "mcp" || parts[1].is_empty() || parts[2].is_empty() {
        // List available tools to help the AI self-correct
        let tools = get_builtin_tools();
        let available: Vec<String> = tools.iter().map(|t| t.full_name()).collect();
        return Err(Error::new(
            Status::InvalidArg,
            format!(
                "Invalid tool name format: \"{}\". Expected format: mcp__{{server}}__{{tool}}. Available tools: [{}]",
                full_name,
                available.join(", ")
            ),
        ));
    }

    let server_id = parts[1];
    let tool_name = parts[2];

    let services = builtin_services();
    let service = services.get(server_id).ok_or_else(|| {
        let available_servers: Vec<String> = services.keys().cloned().collect();
        Error::new(
            Status::GenericFailure,
            format!(
                "Unknown MCP server: \"{}\". Available servers: [{}]",
                server_id,
                available_servers.join(", ")
            ),
        )
    })?;

    service.execute(tool_name, args)
}
