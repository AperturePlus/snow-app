use napi::bindgen_prelude::*;

use crate::api::responses::ResponsesApiRequest;
use crate::mcp::tools::{collect_all_mcp_tools, collect_allowed_mcp_tools, McpTool};

/// Resolve the MCP tool set for a request. When `sub_agent_tools_json` is
/// present and non-empty, the tools are filtered by the configured whitelist
/// via `collect_allowed_mcp_tools`. Otherwise all project-scoped tools are
/// collected via `collect_all_mcp_tools` (the normal main-conversation path).
pub async fn resolve_sub_agent_tools(
    request: &ResponsesApiRequest,
) -> Result<Vec<McpTool>> {
    match request.sub_agent_tools_json.as_deref() {
        Some(tools_json) if !tools_json.trim().is_empty() => {
            collect_allowed_mcp_tools(
                request.directory_id.as_deref(),
                tools_json,
                true,
            )
            .await
        }
        _ => collect_all_mcp_tools(request.directory_id.as_deref()).await,
    }
}
