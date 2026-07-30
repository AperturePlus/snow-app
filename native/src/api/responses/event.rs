//! Responses API stream-event helpers — token usage extraction, reasoning
//! text collection, tool-call collection, and output text extraction.

use serde_json::Value;

use crate::api::common::read_first_i64;
use crate::storage::services::chat_conversations::ChatTokenUsage;

/// Read a streaming text delta from a Responses API event.
pub(super) fn read_stream_text_delta(value: Option<&Value>) -> String {
    value
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty())
        .map(ToString::to_string)
        .unwrap_or_default()
}

/// Extract token usage from a Responses API `response` JSON object.
pub(super) fn extract_token_usage(response: &Value) -> ChatTokenUsage {
    let usage = response.get("usage").unwrap_or(response);

    ChatTokenUsage {
        input_tokens: read_first_i64(
            usage,
            &[&["input_tokens"], &["prompt_tokens"], &["total_input_tokens"]],
        ),
        output_tokens: read_first_i64(
            usage,
            &[&["output_tokens"], &["completion_tokens"], &["total_output_tokens"]],
        ),
        cache_creation_input_tokens: read_first_i64(
            usage,
            &[
                &["cache_creation_input_tokens"],
                &["prompt_cache_creation_tokens"],
                &["input_tokens_details", "cache_creation_input_tokens"],
                &["input_tokens_details", "cache_creation_tokens"],
                &["prompt_tokens_details", "cache_creation_input_tokens"],
                &["prompt_tokens_details", "cache_creation_tokens"],
            ],
        ),
        cache_read_input_tokens: read_first_i64(
            usage,
            &[
                &["cache_read_input_tokens"],
                &["cache_hit_input_tokens"],
                &["cache_hit_tokens"],
                &["prompt_cache_hit_tokens"],
                &["cached_tokens"],
                &["input_tokens_details", "cache_read_input_tokens"],
                &["input_tokens_details", "cache_hit_tokens"],
                &["input_tokens_details", "cached_tokens"],
                &["prompt_tokens_details", "cache_read_input_tokens"],
                &["prompt_tokens_details", "cache_hit_tokens"],
                &["prompt_tokens_details", "cached_tokens"],
            ],
        ),
    }
}

/// Extract thinking/reasoning text from a completed Responses API response.
pub(super) fn extract_response_thinking(response: &Value) -> String {
    let mut chunks = Vec::new();
    collect_reasoning_text(response.get("output"), &mut chunks);
    chunks.join("\n").trim().to_string()
}

/// Recursively collect reasoning text from a Responses API output tree.
pub(super) fn collect_reasoning_text(value: Option<&Value>, chunks: &mut Vec<String>) {
    let Some(value) = value else {
        return;
    };

    match value {
        Value::Array(items) => {
            for item in items {
                collect_reasoning_text(Some(item), chunks);
            }
        }
        Value::Object(object) => {
            let is_reasoning = object
                .get("type")
                .and_then(Value::as_str)
                .is_some_and(|value| value == "reasoning");
            if is_reasoning {
                collect_text_values(value, chunks);
                return;
            }

            collect_reasoning_text(object.get("summary"), chunks);
            collect_reasoning_text(object.get("content"), chunks);
        }
        _ => {}
    }
}

/// Collect text values from a JSON tree, handling strings, arrays, and
/// objects with text-like fields.
pub(super) fn collect_text_values(value: &Value, chunks: &mut Vec<String>) {
    match value {
        Value::String(text) => {
            let text = text.trim();
            if !text.is_empty() {
                chunks.push(text.to_string());
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_text_values(item, chunks);
            }
        }
        Value::Object(object) => {
            for key in ["text", "summary_text", "content", "value"] {
                if let Some(text) = object
                    .get(key)
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    chunks.push(text.to_string());
                }
            }

            for key in ["summary", "content"] {
                if let Some(child) = object.get(key) {
                    collect_text_values(child, chunks);
                }
            }
        }
        _ => {}
    }
}

/// Collect tool calls from a Responses API JSON tree.
///
/// Detects items whose `type` is one of the known tool-call variants, or
/// objects that have a `call_id` plus `name`/`arguments` shape.
pub(super) fn collect_tool_calls(value: Option<&Value>, calls: &mut Vec<Value>) {
    let Some(value) = value else {
        return;
    };

    match value {
        Value::Array(items) => {
            for item in items {
                collect_tool_calls(Some(item), calls);
            }
        }
        Value::Object(object) => {
            let is_tool_call = object
                .get("type")
                .and_then(Value::as_str)
                .is_some_and(|value| {
                    matches!(
                        value,
                        "function_call" | "tool_call" | "custom_tool_call" | "mcp_call"
                    )
                });
            let has_call_shape = object.contains_key("call_id")
                && (object.contains_key("name") || object.contains_key("arguments"));

            if is_tool_call || has_call_shape {
                calls.push(value.clone());
                return;
            }

            collect_tool_calls(object.get("content"), calls);
        }
        _ => {}
    }
}

/// Read a string field from a Responses API response object.
pub(super) fn read_response_string(response: &Value, key: &str) -> Option<String> {
    response
        .get(key)
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

/// Extract output text from a completed Responses API response.
pub(super) fn extract_output_text(response: &Value) -> String {
    if let Some(output_text) = response
        .get("output_text")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return output_text.to_string();
    }

    let mut chunks = Vec::new();
    collect_output_text(response.get("output"), &mut chunks);

    chunks.join("\n").trim().to_string()
}

/// Recursively collect output text from a Responses API output tree.
pub(super) fn collect_output_text(value: Option<&Value>, chunks: &mut Vec<String>) {
    let Some(value) = value else {
        return;
    };

    match value {
        Value::Array(items) => {
            for item in items {
                collect_output_text(Some(item), chunks);
            }
        }
        Value::Object(object) => {
            for key in ["text", "output_text", "value"] {
                if let Some(text) = object
                    .get(key)
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    chunks.push(text.to_string());
                    return;
                }
            }

            collect_output_text(object.get("content"), chunks);
        }
        _ => {}
    }
}


