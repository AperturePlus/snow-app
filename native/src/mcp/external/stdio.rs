use std::collections::HashMap;
use std::process::Stdio;
use std::time::Duration;

use napi::{Error, Result};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::task::JoinHandle;
use tokio::time::timeout;

use crate::storage::McpServerConfigRecord;

use super::super::protocol::{
    initialize_params, method_not_found_response, notification, parse_tools_page, request,
    response_id_matches, response_result, RemoteMcpTool,
};

const DEFAULT_TIMEOUT_MS: u64 = 300_000;

pub(super) struct StdioMcpClient {
    child: Child,
    stdin: ChildStdin,
    stdout: Lines<BufReader<ChildStdout>>,
    stderr_task: JoinHandle<()>,
    next_id: i64,
    request_timeout: Duration,
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
        let mut command = Command::new(command_name);
        command
            .args(args)
            .envs(environment)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        let mut child = command.spawn().map_err(|error| {
            Error::from_reason(format!(
                "Failed to start external MCP server {}: {error}",
                config.name
            ))
        })?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| Error::from_reason("External MCP child stdin is unavailable"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| Error::from_reason("External MCP child stdout is unavailable"))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| Error::from_reason("External MCP child stderr is unavailable"))?;
        let stderr_task = tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while matches!(lines.next_line().await, Ok(Some(_))) {}
        });

        let mut client = Self {
            child,
            stdin,
            stdout: BufReader::new(stdout).lines(),
            stderr_task,
            next_id: 1,
            request_timeout: config_timeout(config),
        };
        let initialize_result = client
            .send_request("initialize", initialize_params())
            .await?;
        if initialize_result.get("protocolVersion").is_none() {
            client.close().await;
            return Err(Error::from_reason(format!(
                "External MCP server {} returned an invalid initialize result",
                config.name
            )));
        }
        client
            .send_notification("notifications/initialized", json!({}))
            .await?;

        Ok(client)
    }

    pub(super) async fn list_all_tools(&mut self) -> Result<Vec<RemoteMcpTool>> {
        let mut tools = Vec::new();
        let mut cursor: Option<String> = None;

        loop {
            let params = cursor
                .as_ref()
                .map(|cursor| json!({ "cursor": cursor }))
                .unwrap_or_else(|| json!({}));
            let result = self.send_request("tools/list", params).await?;
            let (page, next_cursor) = parse_tools_page(&result)?;
            tools.extend(page);
            cursor = next_cursor;
            if cursor.is_none() {
                break;
            }
        }

        Ok(tools)
    }

    pub(super) async fn call_tool(&mut self, name: &str, arguments: &Value) -> Result<Value> {
        self.send_request(
            "tools/call",
            json!({
                "name": name,
                "arguments": arguments,
            }),
        )
        .await
    }

    pub(super) async fn close(mut self) {
        let _ = self.child.kill().await;
        let _ = self.child.wait().await;
        self.stderr_task.abort();
    }

    async fn send_request(&mut self, method: &str, params: Value) -> Result<Value> {
        let duration = self.request_timeout;
        timeout(duration, self.send_request_inner(method, params))
            .await
            .map_err(|_| {
                Error::from_reason(format!(
                    "External MCP stdio request {method} timed out after {} ms",
                    duration.as_millis()
                ))
            })?
    }

    async fn send_request_inner(&mut self, method: &str, params: Value) -> Result<Value> {
        let id = self.next_id;
        self.next_id += 1;
        self.write_message(&request(id, method, params)).await?;

        loop {
            let line = self.stdout.next_line().await.map_err(|error| {
                Error::from_reason(format!("Failed to read external MCP stdout: {error}"))
            })?;
            let Some(line) = line else {
                return Err(Error::from_reason(format!(
                    "External MCP server exited while handling {method}"
                )));
            };
            let Ok(message) = serde_json::from_str::<Value>(&line) else {
                continue;
            };

            if response_id_matches(&message, id) {
                return response_result(message, method);
            }

            if let (Some(server_request_id), Some(server_method)) =
                (message.get("id").cloned(), message.get("method").and_then(Value::as_str))
            {
                let response = method_not_found_response(server_request_id, server_method);
                self.write_message(&response).await?;
            }
        }
    }

    async fn send_notification(&mut self, method: &str, params: Value) -> Result<()> {
        let duration = self.request_timeout;
        timeout(duration, self.write_message(&notification(method, params)))
            .await
            .map_err(|_| {
                Error::from_reason(format!(
                    "External MCP stdio notification {method} timed out after {} ms",
                    duration.as_millis()
                ))
            })?
    }

    async fn write_message(&mut self, message: &Value) -> Result<()> {
        let serialized = serde_json::to_vec(message).map_err(|error| {
            Error::from_reason(format!("Failed to serialize external MCP message: {error}"))
        })?;
        self.stdin.write_all(&serialized).await.map_err(|error| {
            Error::from_reason(format!("Failed to write external MCP stdin: {error}"))
        })?;
        self.stdin.write_all(b"\n").await.map_err(|error| {
            Error::from_reason(format!("Failed to write external MCP delimiter: {error}"))
        })?;
        self.stdin.flush().await.map_err(|error| {
            Error::from_reason(format!("Failed to flush external MCP stdin: {error}"))
        })
    }
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
