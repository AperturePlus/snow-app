use serde_json::Value;

/// Convert stored OpenAI-format tool_calls_json into Anthropic tool_use content blocks.
pub fn tool_calls_as_anthropic_blocks(tool_calls_json: &str) -> Vec<Value> {
    let Ok(parsed) = serde_json::from_str::<Value>(tool_calls_json) else {
        return Vec::new();
    };
    let Some(array) = parsed.as_array() else {
        return Vec::new();
    };

    array
        .iter()
        .filter_map(|call| {
            let id = call.get("id")?.as_str()?.to_string();
            let function = call.get("function")?;
            let name = function.get("name")?.as_str()?.to_string();
            let arguments_str = function.get("arguments")?.as_str().unwrap_or("{}");
            let input: Value =
                serde_json::from_str(arguments_str).unwrap_or_else(|_| serde_json::json!({}));

            Some(serde_json::json!({
                "type": "tool_use",
                "id": id,
                "name": name,
                "input": input,
            }))
        })
        .collect()
}

/// Convert stored OpenAI-format tool_calls_json into Gemini functionCall parts.
pub fn tool_calls_as_gemini_parts(tool_calls_json: &str) -> Vec<Value> {
    let Ok(parsed) = serde_json::from_str::<Value>(tool_calls_json) else {
        return Vec::new();
    };
    let Some(array) = parsed.as_array() else {
        return Vec::new();
    };

    array
        .iter()
        .filter_map(|call| {
            let function = call.get("function")?;
            let name = function.get("name")?.as_str()?.to_string();
            let arguments_str = function.get("arguments")?.as_str().unwrap_or("{}");
            let args: Value =
                serde_json::from_str(arguments_str).unwrap_or_else(|_| serde_json::json!({}));

            Some(serde_json::json!({
                "functionCall": {
                    "name": name,
                    "args": args,
                }
            }))
        })
        .collect()
}

/// Parse tool_results_json into (name, callId, result) tuples.
pub fn parse_tool_results_json(raw: &str) -> Vec<(String, String, String)> {
    serde_json::from_str::<Vec<Value>>(raw)
        .unwrap_or_default()
        .into_iter()
        .map(|v| {
            let name = v.get("name").and_then(|x| x.as_str()).unwrap_or("").to_string();
            let call_id = v.get("callId").and_then(|x| x.as_str()).unwrap_or("").to_string();
            let result = v.get("result").and_then(|x| x.as_str()).unwrap_or("").to_string();
            (name, call_id, result)
        })
        .collect()
}
