use std::collections::HashMap;
use std::process::Stdio;
use std::time::Duration;

use napi::{Error, Result};
use rmcp::model::ClientInfo;
use rmcp::service::{ClientLifecycleMode, ClientServiceExt, RunningService};
use tokio::process::Command;

use crate::exports::terminal::{detect_shell_family, resolve_login_path};
use crate::storage::McpServerConfigRecord;

use super::super::protocol::RemoteMcpTool;

const DEFAULT_TIMEOUT_MS: u64 = 300_000;

pub(super) type StdioRunningClient = RunningService<rmcp::RoleClient, ClientInfo>;

pub(super) struct StdioMcpClient {
    client: StdioRunningClient,
}

impl StdioMcpClient {
    pub(super) async fn connect(config: &McpServerConfigRecord) -> Result<Self> {
        let command_name = config.command.trim();
        if command_name.is_empty() {
            return Err(Error::from_reason(format!(
                "External MCP server {} has no command",
                config.name
            )));
        }

        let args = parse_string_array(&config.args_json, "args")?;
        let environment = parse_string_map(&config.env_json, "environment")?;
        let _timeout = config_timeout(config);

        let mut command = Command::new(command_name);
        command.args(args);

        // GUI 启动的 Electron（macOS Finder / Windows 资源管理器）进程 PATH 不完整，
        // 不含 Homebrew/nvm 等路径，导致 npx 等命令无法解析。注入 login shell
        // （Unix 上冒号分隔）或注册表（Windows 上分号分隔）的 PATH。
        // WSL 命令跳过：resolve_login_path 在 Windows 上返回的是 Windows 注册表
        // PATH（分号分隔），注入会覆盖 WSL 内有效的 Linux PATH（冒号分隔）；
        // WSL 通过 bash -l 自行从 .profile 加载正确的 Linux PATH。
        if detect_shell_family(command_name) != "wsl" {
            if let Some(path) = resolve_login_path().await {
                command.env("PATH", path);
            }
        }

        // 配置里显式声明的 env 最后注入，覆盖 login PATH（如用户自定义 PATH）。
        command.envs(environment);

        #[cfg(target_os = "windows")]
        {
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            use std::os::windows::process::CommandExt;
            command.creation_flags(CREATE_NO_WINDOW);
        }

        // Use the builder so we can pipe stderr for diagnostics while keeping
        // stdin/stdout piped (the defaults).
        let (transport, _stderr_opt) = rmcp::transport::TokioChildProcess::builder(command)
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| {
                Error::from_reason(format!(
                    "Failed to start external MCP server {}: {error}",
                    config.name
                ))
            })?;

        let client_info = ClientInfo::default();
        let lifecycle = ClientLifecycleMode::Auto {
            preferred_versions: vec![rmcp::model::ProtocolVersion::V_2026_07_28],
            legacy_version: Some(rmcp::model::ProtocolVersion::V_2025_11_25),
        };

        let running = client_info
            .serve_with_lifecycle(transport, lifecycle)
            .await
            .map_err(|error| {
                Error::from_reason(format!(
                    "Failed to initialize external MCP stdio server {}: {error}",
                    config.name
                ))
            })?;

        Ok(Self { client: running })
    }

    pub(super) async fn list_all_tools(&self) -> Result<Vec<RemoteMcpTool>> {
        let tools = self.client.list_all_tools().await.map_err(|error| {
            Error::from_reason(format!("External MCP tools/list failed: {error}"))
        })?;
        Ok(tools.into_iter().map(rmcp_tool_to_remote).collect())
    }

    pub(super) async fn call_tool(
        &self,
        name: &str,
        arguments: &serde_json::Value,
    ) -> Result<serde_json::Value> {
        let params = rmcp::model::CallToolRequestParams::new(name.to_string());
        let params = if let Some(obj) = arguments.as_object() {
            params.with_arguments(obj.clone())
        } else {
            params
        };

        let result = self.client.call_tool(params).await.map_err(|error| {
            Error::from_reason(format!("External MCP tools/call failed: {error}"))
        })?;

        Ok(call_tool_result_to_value(result))
    }

    pub(super) async fn close(mut self) {
        let _ = self.client.close().await;
    }
}

fn rmcp_tool_to_remote(tool: rmcp::model::Tool) -> RemoteMcpTool {
    let name = tool.name.to_string();
    let description = tool
        .description
        .as_deref()
        .unwrap_or_default()
        .to_string();
    let input_schema = serde_json::to_value(tool.input_schema.as_ref()).unwrap_or_else(|_| {
        serde_json::json!({ "type": "object", "properties": {} })
    });
    RemoteMcpTool {
        name,
        description,
        input_schema,
    }
}

fn call_tool_result_to_value(result: rmcp::model::CallToolResult) -> serde_json::Value {
    serde_json::to_value(&result).unwrap_or_else(|_| {
        serde_json::json!({ "content": [], "isError": false })
    })
}

fn parse_string_array(value: &str, field: &str) -> Result<Vec<String>> {
    serde_json::from_str(value).map_err(|error| {
        Error::from_reason(format!("Invalid external MCP {field} JSON: {error}"))
    })
}

fn parse_string_map(value: &str, field: &str) -> Result<HashMap<String, String>> {
    serde_json::from_str(value).map_err(|error| {
        Error::from_reason(format!("Invalid external MCP {field} JSON: {error}"))
    })
}

fn config_timeout(config: &McpServerConfigRecord) -> Duration {
    let timeout_ms = config
        .timeout_ms
        .filter(|timeout| *timeout > 0)
        .map(|timeout| timeout as u64)
        .unwrap_or(DEFAULT_TIMEOUT_MS);
    Duration::from_millis(timeout_ms)
}
