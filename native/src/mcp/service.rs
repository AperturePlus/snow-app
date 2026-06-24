use serde_json::Value;

use super::tools::McpTool;

/// 每个 MCP 服务实现的 trait，包含工具定义和工具执行。
pub trait McpService: Send + Sync {
    /// 服务唯一标识，如 "filesystem"
    fn id(&self) -> &str;

    /// 返回该服务下所有工具的定义
    fn tools(&self) -> Vec<McpTool>;

    /// 执行指定工具，返回 JSON 结果
    fn execute(&self, tool_name: &str, args: &Value) -> napi::Result<Value>;
}
