use std::collections::HashMap;
use std::sync::Arc;

use napi::bindgen_prelude::*;
use serde_json::Value;

use super::service::McpService;
use super::servers::bash::BashService;
use super::servers::browser::BrowserService;
use super::servers::filesystem::FilesystemService;
use super::servers::grep::GrepService;
use super::servers::sub_agents::SubAgentsService;
use super::servers::todo::TodoService;
use super::servers::user_interaction::UserInteractionService;
use super::servers::websearch::WebSearchService;
use super::tools::McpTool;

/// 按固定注册顺序构造内置 MCP 服务。
///
/// 工具定义会直接出现在模型请求体中；因此绝不能通过 HashMap 迭代来
/// 生成工具数组，否则每个进程的随机哈希种子都可能改变请求体顺序并使
/// prompt cache 失效。新增内置服务必须追加到列表末尾。
fn builtin_services_in_order() -> Vec<Arc<dyn McpService>> {
    vec![
        Arc::new(FilesystemService::new()),
        Arc::new(BashService::new()),
        Arc::new(TodoService::new()),
        Arc::new(GrepService::new()),
        Arc::new(WebSearchService::new()),
        Arc::new(BrowserService::new()),
        Arc::new(UserInteractionService::new()),
        Arc::new(SubAgentsService::new()),
    ]
}

/// 注册所有内置 MCP 服务，返回 server_id -> service 的映射。
pub fn builtin_services() -> HashMap<String, Arc<dyn McpService>> {
    builtin_services_in_order()
        .into_iter()
        .map(|service| (service.id().to_string(), service))
        .collect()
}

/// 返回所有内置服务及其工具定义，保持与注册列表一致的固定顺序。
pub fn get_builtin_servers_with_tools() -> Vec<(String, Vec<McpTool>)> {
    builtin_services_in_order()
        .into_iter()
        .map(|service| (service.id().to_string(), service.tools()))
        .collect()
}

/// 返回所有内置服务的工具定义，保持与注册列表一致的固定顺序。
pub fn get_builtin_tools() -> Vec<McpTool> {
    get_builtin_servers_with_tools()
        .into_iter()
        .flat_map(|(_, tools)| tools)
        .collect()
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
