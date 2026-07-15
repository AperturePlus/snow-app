use napi::{Error, Result};
use serde_json::{json, Value};

pub const MCP_PROTOCOL_VERSION: &str = "2025-11-25";

#[derive(Clone, Debug)]
pub struct RemoteMcpTool {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

pub fn request(id: i64, method: &str, params: Value) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": method,
        "params": params,
    })
}

pub fn notification(method: &str, params: Value) -> Value {
    json!({
        "jsonrpc": "2.0",
        "method": method,
        "params": params,
    })
}

pub fn initialize_params() -> Value {
    json!({
        "protocolVersion": MCP_PROTOCOL_VERSION,
        "capabilities": {},
        "clientInfo": {
            "name": "snow-app",
            "version": env!("CARGO_PKG_VERSION"),
        },
    })
}

pub fn response_id_matches(message: &Value, expected_id: i64) -> bool {
    message.get("id").and_then(Value::as_i64) == Some(expected_id)
}

pub fn response_result(message: Value, method: &str) -> Result<Value> {
    if let Some(error) = message.get("error") {
        let code = error.get("code").and_then(Value::as_i64).unwrap_or(-1);
        let message = error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("Unknown MCP error");
        return Err(Error::from_reason(format!(
            "External MCP request {method} failed ({code}): {message}"
        )));
    }

    message
        .get("result")
        .cloned()
        .ok_or_else(|| Error::from_reason(format!("External MCP request {method} returned no result")))
}

pub fn parse_tools_page(result: &Value) -> Result<(Vec<RemoteMcpTool>, Option<String>)> {
    let tools = result
        .get("tools")
        .and_then(Value::as_array)
        .ok_or_else(|| Error::from_reason("External MCP tools/list returned no tools array"))?;

    let mut parsed = Vec::with_capacity(tools.len());
    for tool in tools {
        let name = tool
            .get("name")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .ok_or_else(|| Error::from_reason("External MCP tool is missing a name"))?;
        let description = tool
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let input_schema = tool
            .get("inputSchema")
            .cloned()
            .filter(Value::is_object)
            .unwrap_or_else(|| json!({ "type": "object", "properties": {} }));

        parsed.push(RemoteMcpTool {
            name: name.to_string(),
            description,
            input_schema,
        });
    }

    let next_cursor = result
        .get("nextCursor")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|cursor| !cursor.is_empty())
        .map(ToOwned::to_owned);

    Ok((parsed, next_cursor))
}

pub fn method_not_found_response(id: Value, method: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": {
            "code": -32601,
            "message": format!("Snow App MCP client does not implement server request {method}"),
        },
    })
}
