use std::collections::HashMap;
use std::time::Duration;

use http::header::{HeaderName, HeaderValue};
use napi::{Error, Result};
use rmcp::model::ClientInfo;
use rmcp::service::{ClientLifecycleMode, ClientServiceExt, RunningService};
use rmcp::transport::{
    streamable_http_client::StreamableHttpClientTransportConfig, StreamableHttpClientTransport,
};

use crate::storage::McpServerConfigRecord;

use super::super::protocol::RemoteMcpTool;

const DEFAULT_TIMEOUT_MS: u64 = 300_000;

pub(super) type HttpRunningClient = RunningService<rmcp::RoleClient, ClientInfo>;

pub(super) struct HttpMcpClient {
    client: HttpRunningClient,
}

impl HttpMcpClient {
    pub(super) async fn connect(config: &McpServerConfigRecord) -> Result<Self> {
        let url = config.url.trim();
        if url.is_empty() {
            return Err(Error::from_reason(format!(
                "External MCP server {} has no URL",
                config.name
            )));
        }

        let custom_headers = parse_headers(&config.headers_json)?;
        let _timeout = config_timeout(config);

        let mut transport_config = StreamableHttpClientTransportConfig::with_uri(url);
        if !custom_headers.is_empty() {
            transport_config = transport_config.custom_headers(custom_headers);
        }

        let transport: StreamableHttpClientTransport<_> =
            StreamableHttpClientTransport::from_config(transport_config);

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
                    "Failed to connect external MCP HTTP server {}: {error}",
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
    // Serialize the entire CallToolResult as JSON. This preserves content blocks,
    // is_error flag, and structured_content so callers can interpret it fully.
    serde_json::to_value(&result).unwrap_or_else(|_| {
        serde_json::json!({ "content": [], "isError": false })
    })
}

fn parse_headers(value: &str) -> Result<HashMap<HeaderName, HeaderValue>> {
    let headers: HashMap<String, String> = serde_json::from_str(value).map_err(|error| {
        Error::from_reason(format!("Invalid external MCP headers JSON: {error}"))
    })?;
    let mut result = HashMap::new();
    for (name, value) in headers {
        let name = name.parse::<HeaderName>().map_err(|error| {
            Error::from_reason(format!("Invalid external MCP header name: {error}"))
        })?;
        let value = HeaderValue::from_str(&value).map_err(|error| {
            Error::from_reason(format!("Invalid external MCP header value: {error}"))
        })?;
        result.insert(name, value);
    }
    Ok(result)
}

fn config_timeout(config: &McpServerConfigRecord) -> Duration {
    let timeout_ms = config
        .timeout_ms
        .filter(|timeout| *timeout > 0)
        .map(|timeout| timeout as u64)
        .unwrap_or(DEFAULT_TIMEOUT_MS);
    Duration::from_millis(timeout_ms)
}
