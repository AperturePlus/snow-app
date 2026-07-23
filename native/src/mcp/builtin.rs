use std::collections::HashMap;
use std::sync::Arc;

use napi::bindgen_prelude::*;
use serde_json::Value;

use super::service::McpService;
use super::servers::bash::BashService;
use super::servers::browser::BrowserService;
use super::servers::codebase::CodebaseService;
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
        Arc::new(CodebaseService::new()),
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
    // Sanitize: AI may copy "[Tool: mcp__x__y#callId]" from conversation history
    // or leak internal XML tags into the tool name. Extract a valid
    // mcp__{server}__{tool} pattern before splitting.
    let sanitized = sanitize_tool_full_name(full_name);
    let parts: Vec<&str> = sanitized.splitn(3, "__").collect();
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

/// Extract a valid `mcp__{server}__{tool}` name from a possibly polluted
/// string. AI may copy the "[Tool: mcp__x__y#callId]" format from conversation
/// history or leak internal XML tags (e.g. `</arg_value>`) into the tool name.
/// If a valid MCP pattern is found, return it; otherwise return the original
/// string so the caller can produce a descriptive error.
pub fn sanitize_tool_full_name(raw: &str) -> String {
    // Fast path: already a clean name
    if raw.starts_with("mcp__") && !raw.contains(['<', '>', '[', ']', '#']) {
        return raw.to_string();
    }

    // Search for the pattern mcp__{server}__{tool} where server and tool
    // consist of alphanumeric, underscore, and hyphen characters.
    let bytes = raw.as_bytes();
    let mut start = None;
    let mut end = 0;

    for i in 0..bytes.len() {
        if raw[i..].starts_with("mcp__") {
            // Scan forward to capture the full pattern
            let mut j = i + 5; // skip "mcp__"
            // server_id: [A-Za-z0-9_-]+
            while j < bytes.len() && (bytes[j].is_ascii_alphanumeric() || bytes[j] == b'_' || bytes[j] == b'-') {
                j += 1;
            }
            // Expect "__"
            if j + 2 <= bytes.len() && &raw[j..j + 2] == "__" {
                j += 2;
                // tool_name: [A-Za-z0-9_-]+
                let tool_start = j;
                while j < bytes.len() && (bytes[j].is_ascii_alphanumeric() || bytes[j] == b'_' || bytes[j] == b'-') {
                    j += 1;
                }
                if j > tool_start {
                    start = Some(i);
                    end = j;
                    break;
                }
            }
        }
    }

    match start {
        Some(s) => raw[s..end].to_string(),
        None => raw.to_string(),
    }
}
