use std::collections::HashMap;
use std::time::Duration;

use futures::StreamExt;
use napi::{Error, Result};
use reqwest::header::{
    HeaderMap, HeaderName, HeaderValue, ACCEPT, CONTENT_TYPE,
};
use serde_json::{json, Value};

use crate::storage::McpServerConfigRecord;

use super::super::protocol::{
    initialize_params, notification, parse_tools_page, request, response_id_matches,
    response_result, RemoteMcpTool, MCP_PROTOCOL_VERSION,
};

const DEFAULT_TIMEOUT_MS: u64 = 300_000;
const MCP_SESSION_ID_HEADER: &str = "mcp-session-id";
const MCP_PROTOCOL_VERSION_HEADER: &str = "mcp-protocol-version";

pub(super) struct HttpMcpClient {
    client: reqwest::Client,
    url: String,
    session_id: Option<String>,
    protocol_version: String,
    next_id: i64,
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

        let default_headers = parse_headers(&config.headers_json)?;
        let client = reqwest::Client::builder()
            .default_headers(default_headers)
            .timeout(config_timeout(config))
            .build()
            .map_err(|error| {
                Error::from_reason(format!("Failed to create external MCP HTTP client: {error}"))
            })?;
        let mut mcp = Self {
            client,
            url: url.to_string(),
            session_id: None,
            protocol_version: MCP_PROTOCOL_VERSION.to_string(),
            next_id: 1,
        };

        let initialize_result = mcp
            .send_request("initialize", initialize_params(), false)
            .await?;
        mcp.protocol_version = initialize_result
            .get("protocolVersion")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|version| !version.is_empty())
            .ok_or_else(|| {
                Error::from_reason(format!(
                    "External MCP server {} returned an invalid initialize result",
                    config.name
                ))
            })?
            .to_string();
        mcp.send_notification("notifications/initialized", json!({}))
            .await?;

        Ok(mcp)
    }

    pub(super) async fn list_all_tools(&mut self) -> Result<Vec<RemoteMcpTool>> {
        let mut tools = Vec::new();
        let mut cursor: Option<String> = None;

        loop {
            let params = cursor
                .as_ref()
                .map(|cursor| json!({ "cursor": cursor }))
                .unwrap_or_else(|| json!({}));
            let result = self.send_request("tools/list", params, true).await?;
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
            true,
        )
        .await
    }

    pub(super) async fn close(self) {
        if self.session_id.is_none() {
            return;
        }
        let mut request = self.client.delete(&self.url);
        request = self.apply_session_headers(request);
        let _ = request.send().await;
    }

    async fn send_request(
        &mut self,
        method: &str,
        params: Value,
        include_protocol_version: bool,
    ) -> Result<Value> {
        let id = self.next_id;
        self.next_id += 1;
        let mut request_builder = self
            .client
            .post(&self.url)
            .header(ACCEPT, "application/json, text/event-stream")
            .header(CONTENT_TYPE, "application/json");
        if include_protocol_version {
            request_builder = self.apply_session_headers(request_builder);
        }
        let response = request_builder
            .json(&request(id, method, params))
            .send()
            .await
            .map_err(|error| {
                Error::from_reason(format!("External MCP HTTP request {method} failed: {error}"))
            })?;

        if let Some(session_id) = response
            .headers()
            .get(MCP_SESSION_ID_HEADER)
            .and_then(|value| value.to_str().ok())
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            self.session_id = Some(session_id.to_string());
        }
        let message = parse_http_response(response, method, id).await?;
        response_result(message, method)
    }

    async fn send_notification(&self, method: &str, params: Value) -> Result<()> {
        let request_builder = self
            .client
            .post(&self.url)
            .header(ACCEPT, "application/json, text/event-stream")
            .header(CONTENT_TYPE, "application/json");
        let response = self
            .apply_session_headers(request_builder)
            .json(&notification(method, params))
            .send()
            .await
            .map_err(|error| {
                Error::from_reason(format!(
                    "External MCP HTTP notification {method} failed: {error}"
                ))
            })?;
        ensure_success(response, method).await.map(|_| ())
    }

    fn apply_session_headers(
        &self,
        mut request: reqwest::RequestBuilder,
    ) -> reqwest::RequestBuilder {
        request = request.header(MCP_PROTOCOL_VERSION_HEADER, &self.protocol_version);
        if let Some(session_id) = &self.session_id {
            request = request.header(MCP_SESSION_ID_HEADER, session_id);
        }
        request
    }
}

async fn parse_http_response(
    response: reqwest::Response,
    method: &str,
    expected_id: i64,
) -> Result<Value> {
    let response = ensure_success(response, method).await?;
    let is_sse = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.to_ascii_lowercase().contains("text/event-stream"));

    if !is_sse {
        let message = response.json::<Value>().await.map_err(|error| {
            Error::from_reason(format!(
                "Failed to parse external MCP HTTP response for {method}: {error}"
            ))
        })?;
        if response_id_matches(&message, expected_id) {
            return Ok(message);
        }
        return Err(Error::from_reason(format!(
            "External MCP HTTP response for {method} has an unexpected request id"
        )));
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| {
            Error::from_reason(format!(
                "Failed to read external MCP HTTP event stream for {method}: {error}"
            ))
        })?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));
        buffer = buffer.replace("\r\n", "\n");

        while let Some(boundary) = buffer.find("\n\n") {
            let event = buffer[..boundary].to_string();
            buffer.drain(..boundary + 2);
            let data = event
                .lines()
                .filter_map(|line| line.strip_prefix("data:"))
                .map(str::trim_start)
                .collect::<Vec<_>>()
                .join("\n");
            if data.is_empty() {
                continue;
            }
            let Ok(message) = serde_json::from_str::<Value>(&data) else {
                continue;
            };
            if response_id_matches(&message, expected_id) {
                return Ok(message);
            }
        }
    }

    Err(Error::from_reason(format!(
        "External MCP HTTP event stream ended before {method} returned a response"
    )))
}

async fn ensure_success(
    response: reqwest::Response,
    method: &str,
) -> Result<reqwest::Response> {
    if response.status().is_success() {
        return Ok(response);
    }

    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    Err(Error::from_reason(format!(
        "External MCP HTTP request {method} failed with {status}: {}",
        body.chars().take(500).collect::<String>()
    )))
}

fn parse_headers(value: &str) -> Result<HeaderMap> {
    let headers: HashMap<String, String> = serde_json::from_str(value).map_err(|error| {
        Error::from_reason(format!("Invalid external MCP headers JSON: {error}"))
    })?;
    let mut result = HeaderMap::new();
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
