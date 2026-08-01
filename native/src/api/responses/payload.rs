//! Responses API payload construction and endpoint/client resolution.

use std::collections::HashMap;
use std::path::Path;

use async_openai::{config::OpenAIConfig, error::OpenAIError, Client};
use napi::bindgen_prelude::*;
use reqwest::header::HeaderMap;
use serde_json::{json, Value};

use crate::api::common::inject_custom_headers;
use crate::api::config::{
    normalize_base_url, resolve_sdk_api_base_url, DEFAULT_OPENAI_BASE_URL,
};
use crate::api::conversation::parse_chat_message_content;
use crate::storage::services::chat_conversations::ChatContextMessage;
use crate::api::responses::ResponsesApiRequest;
use crate::storage::ApiConfigRecord;

pub(super) fn resolve_effective_base_url(api_config: &ApiConfigRecord) -> String {
    let normalized_base_url = normalize_base_url(&api_config.base_url);
    let base_url = if normalized_base_url == DEFAULT_OPENAI_BASE_URL {
        DEFAULT_OPENAI_BASE_URL.to_string()
    } else {
        normalized_base_url
    };

    resolve_sdk_api_base_url(&base_url, &api_config.base_url_mode)
}

pub(super) async fn build_openai_client(
    base_url: &str,
    api_key: &str,
    custom_headers: &HashMap<String, String>,
) -> Result<Client<OpenAIConfig>> {
    let config = OpenAIConfig::new()
        .with_api_key(api_key)
        .with_api_base(base_url);
    let mut default_headers = HeaderMap::new();

    inject_custom_headers(
        &mut default_headers,
        custom_headers,
        &["content-type", "accept-encoding"],
    )?;

    let proxy_config = crate::api::http_client::load_proxy_config().await?;
    let builder = proxy_config
        .apply(reqwest::Client::builder().default_headers(default_headers))?;
    let http_client = builder
        .build()
        .map_err(|error| Error::from_reason(format!("Failed to create HTTP client: {}", error)))?;

    Ok(Client::with_config(config).with_http_client(http_client))
}

pub(super) fn build_responses_payload(
    messages: &[ChatContextMessage],
    database_path: &Path,
    request: &ResponsesApiRequest,
    api_config: &ApiConfigRecord,
    tools: Option<Value>,
    user_system_prompts: &[String],
) -> Result<Value> {
    let model = request
        .model
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| api_config.advanced_model.trim());

    if model.is_empty() {
        return Err(Error::from_reason(
            "Model not configured. Please select or configure a model first.",
        ));
    }

    let skip_image_parsing = request.skip_context.unwrap_or(false);
    let mut builtin_system_parts = Vec::new();
    let mut input = Vec::new();

    for message in messages {
        let content = message.content.trim();
        let role = message.role.trim();

        // --- Tool result messages: emit as function_call_output items ---
        if role == "tool" {
            if content.is_empty() {
                continue;
            }
            let results = match message.tool_results_json {
                Some(ref raw) => crate::api::conversation::tool_messages::parse_tool_results_json(raw),
                None => Vec::new(),
            };
            for (_name, call_id, result) in &results {
                if call_id.is_empty() {
                    input.push(json!({
                        "type": "message",
                        "role": "user",
                        "content": [{"type": "input_text", "text": result}],
                    }));
                } else {
                    input.push(json!({
                        "type": "function_call_output",
                        "call_id": call_id,
                        "output": result,
                    }));
                }
            }
            continue;
        }

        let has_thinking = message
            .thinking
            .as_deref()
            .map(|t| !t.is_empty())
            .unwrap_or(false);

        // Parse persisted reasoning items (with encrypted_content) so they
        // can be emitted as independent top-level items. store:false means
        // the server does not retain reasoning, so we must round-trip it.
        let reasoning_items: Vec<Value> = message
            .thinking_blocks_json
            .as_deref()
            .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
            .and_then(|v| v.as_array().map(|a| a.clone()))
            .unwrap_or_default();
        let has_reasoning = !reasoning_items.is_empty();

        if content.is_empty() && message.tool_calls_json.is_none() && !has_thinking && !has_reasoning {
            continue;
        }

        // --- Assistant messages with tool_calls: emit as function_call items ---
        if role == "assistant" {
            if let Some(ref tool_calls_raw) = message.tool_calls_json {
                if let Ok(parsed) = serde_json::from_str::<Value>(tool_calls_raw) {
                    if let Some(calls) = parsed.as_array() {
                        if !calls.is_empty() {
                            // Emit persisted reasoning items as independent
                            // top-level items before the assistant message.
                            for item in &reasoning_items {
                                input.push(item.clone());
                            }
                            // Emit assistant message with text content.
                            if !content.is_empty() {
                                input.push(json!({
                                    "type": "message",
                                    "role": "assistant",
                                    "content": [{"type": "output_text", "text": content}],
                                }));
                            }
                            // Emit each tool call as a function_call item.
                            // Handles both Responses flat format (call_id /
                            // name / arguments at top level) and Chat
                            // Completions nested format (id / function.name /
                            // function.arguments).
                            for call in calls {
                                let call_id = call
                                    .get("call_id")
                                    .and_then(Value::as_str)
                                    .or_else(|| call.get("id").and_then(Value::as_str))
                                    .unwrap_or("")
                                    .to_string();
                                let name = call
                                    .get("name")
                                    .and_then(Value::as_str)
                                    .or_else(|| {
                                        call.get("function")
                                            .and_then(|f| f.get("name"))
                                            .and_then(Value::as_str)
                                    })
                                    .unwrap_or("")
                                    .to_string();
                                let arguments = call
                                    .get("arguments")
                                    .and_then(Value::as_str)
                                    .or_else(|| {
                                        call.get("function")
                                            .and_then(|f| f.get("arguments"))
                                            .and_then(Value::as_str)
                                    })
                                    .unwrap_or("{}")
                                    .to_string();
                                input.push(json!({
                                    "type": "function_call",
                                    "call_id": call_id,
                                    "name": name,
                                    "arguments": arguments,
                                }));
                            }
                            continue;
                        }
                    }
                }
            }
        }

        // --- System/developer messages: collect into instructions ---
        if role == "system" || role == "developer" {
            if content.is_empty() {
                continue;
            }
            builtin_system_parts.push(content.to_string());
            continue;
        }

        // --- Regular user/assistant messages ---
        if content.is_empty() && !has_thinking && !has_reasoning {
            continue;
        }

        let has_images = !skip_image_parsing
            && parse_chat_message_content(content, database_path)
                .map(|p| !p.images.is_empty())
                .unwrap_or(false);

        // Emit persisted reasoning items as independent top-level items
        // before the assistant message (store:false requires manual
        // round-trip of encrypted_content).
        if role == "assistant" {
            for item in &reasoning_items {
                input.push(item.clone());
            }
        }

        // Build content blocks: user uses input_text, assistant uses output_text.
        let mut content_blocks = Vec::new();

        if !content.is_empty() {
            if skip_image_parsing || !has_images {
                let block_type = if role == "assistant" { "output_text" } else { "input_text" };
                content_blocks.push(json!({"type": block_type, "text": content}));
            } else {
                let parsed_content = parse_chat_message_content(content, database_path)?;
                if !parsed_content.text.is_empty() {
                    let block_type = if role == "assistant" { "output_text" } else { "input_text" };
                    content_blocks.push(json!({"type": block_type, "text": parsed_content.text}));
                }
                for image in &parsed_content.images {
                    content_blocks.push(json!({
                        "type": "input_image",
                        "image_url": image.data_url,
                    }));
                }
            }
        }

        input.push(json!({
            "type": "message",
            "role": normalize_message_role(role),
            "content": content_blocks,
        }));
    }

    // Build `instructions` field. User-configured system prompts take
    // precedence; otherwise the built-in system prompt parts are used. When
    // user system prompts are present, the built-in prompt is demoted to a
    // leading user message (Snow CLI PR #127).
    let mut instructions: Option<String> = None;
    if !user_system_prompts.is_empty() {
        instructions = Some(user_system_prompts.join("\n\n"));

        if !builtin_system_parts.is_empty() {
            let builtin_text = builtin_system_parts.join("\n\n");
            let builtin_message = json!({
                "type": "message",
                "role": "user",
                "content": [{"type": "input_text", "text": builtin_text}],
            });
            input.insert(0, builtin_message);
        }
    } else if !builtin_system_parts.is_empty() {
        instructions = Some(builtin_system_parts.join("\n\n"));
    }

    if input.is_empty() {
        return Err(Error::from_reason("Chat message content is required"));
    }

    // Ensure each `function_call` is immediately followed by its matching
    // `function_call_output`. Some providers (e.g. DeepSeek's official
    // Responses API) strictly validate tool pairs and reject requests where
    // another item — such as a user message interleaved while a tool call was
    // in flight — sits between a call and its output. OpenAI's own API accepts
    // both layouts, so hoisting the output next to its call is safe across
    // providers and preserves the relative order of all other items.
    reorder_tool_pairs(&mut input);

    let mut payload = json!({
        "model": model,
        "input": input,
        "stream": true,
        "store": false,
        "include": ["reasoning.encrypted_content"],
    });

    if let Some(ref instructions) = instructions {
        payload["instructions"] = json!(instructions);
    }

    payload["temperature"] = json!(0.7);

    if let Some(max_tokens) = api_config.max_tokens {
        if max_tokens > 0 {
            payload["max_output_tokens"] = json!(max_tokens);
        }
    }

    if let Some(reasoning) = build_responses_reasoning(&api_config.config_json) {
        payload["reasoning"] = reasoning;
    }

    if let Some(tools) = tools {
        if tools.as_array().is_some_and(|items| !items.is_empty()) {
            payload["tools"] = tools;
        }
    }

    // Add prompt_cache_key using conversation_id so the Responses API can
    // reuse cached prompt prefixes across turns within the same conversation.
    // Matches snow-cli's behavior of passing prompt_cache_key in the payload.
    if let Some(ref conv_id) = request.conversation_id {
        if !conv_id.is_empty() {
            payload["prompt_cache_key"] = json!(conv_id);
        }
    }

    Ok(payload)
}

fn normalize_message_role(role: &str) -> &str {
    match role.trim() {
        "assistant" => "assistant",
        "system" => "system",
        "developer" => "developer",
        _ => "user",
    }
}

fn build_responses_reasoning(config_json: &str) -> Option<Value> {
    let parsed = serde_json::from_str::<Value>(config_json).ok()?;
    let responses_reasoning = parsed
        .get("snowcfg")?
        .get("responsesReasoning")?
        .as_object()?;

    let enabled = responses_reasoning
        .get("enabled")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    if !enabled {
        return None;
    }

    let effort = responses_reasoning
        .get("effort")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != "none")?;

    Some(json!({
        "effort": effort,
        "summary": "auto",
    }))
}

// ---------------------------------------------------------------------------
// Stream type aliases & error helpers
// ---------------------------------------------------------------------------

pub(super) type ResponseValueStream =
    std::pin::Pin<Box<dyn futures::Stream<Item = std::result::Result<Value, OpenAIError>> + Send>>;

pub(super) fn is_stream_ended_error(error: &OpenAIError) -> bool {
    matches!(error, OpenAIError::StreamError(stream_error) if stream_error.to_string() == "Stream ended")
}

/// Reorder input items so every `function_call` is immediately followed by
/// its matching `function_call_output`.
///
/// Some providers (e.g. DeepSeek's official Responses API) validate tool
/// pairs strictly and reject requests where another item — such as a user
/// message interleaved while a tool call was in flight — appears between a
/// `function_call` and its `function_call_output`. OpenAI's own API accepts
/// both layouts, so hoisting the output next to its call is safe across
/// providers. The relative order of all other items is preserved; orphan
/// calls (no matching output anywhere) are left untouched.
fn reorder_tool_pairs(input: &mut Vec<Value>) {
    let mut i = 0;
    while i < input.len() {
        let is_function_call = input[i].get("type").and_then(Value::as_str)
            == Some("function_call");
        if !is_function_call {
            i += 1;
            continue;
        }

        let call_id = input[i]
            .get("call_id")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        if call_id.is_empty() {
            i += 1;
            continue;
        }

        // Already adjacent — nothing to do for this pair.
        let next_is_matching_output = i + 1 < input.len()
            && input[i + 1].get("type").and_then(Value::as_str) == Some("function_call_output")
            && input[i + 1].get("call_id").and_then(Value::as_str) == Some(call_id.as_str());
        if next_is_matching_output {
            i += 2;
            continue;
        }

        // Hoist the matching output so it sits directly after the call.
        if let Some(offset) = input.iter().skip(i + 1).position(|item| {
            item.get("type").and_then(Value::as_str) == Some("function_call_output")
                && item.get("call_id").and_then(Value::as_str) == Some(call_id.as_str())
        }) {
            let output_index = i + 1 + offset;
            let output_item = input.remove(output_index);
            input.insert(i + 1, output_item);
        }

        i += 2;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call(id: &str) -> Value {
        json!({
            "type": "function_call",
            "call_id": id,
            "name": "bash-terminal-execute",
            "arguments": "{}",
        })
    }

    fn output(id: &str) -> Value {
        json!({
            "type": "function_call_output",
            "call_id": id,
            "output": "ok",
        })
    }

    fn user_msg(text: &str) -> Value {
        json!({
            "type": "message",
            "role": "user",
            "content": [{"type": "input_text", "text": text}],
        })
    }

    #[test]
    fn hoists_output_next_to_call_when_user_message_interleaves() {
        let mut input = vec![
            call("call_1"),
            user_msg("interrupted"),
            output("call_1"),
            user_msg("after"),
        ];
        reorder_tool_pairs(&mut input);
        assert_eq!(input[0]["type"], "function_call");
        assert_eq!(input[1]["type"], "function_call_output");
        assert_eq!(input[1]["call_id"], "call_1");
        assert_eq!(input[2]["type"], "message");
        assert_eq!(input[3]["type"], "message");
    }

    #[test]
    fn keeps_already_adjacent_pairs_unchanged() {
        let mut input = vec![
            call("call_1"),
            output("call_1"),
            call("call_2"),
            output("call_2"),
        ];
        let original = input.clone();
        reorder_tool_pairs(&mut input);
        assert_eq!(input, original);
    }

    #[test]
    fn handles_parallel_calls() {
        let mut input = vec![
            call("call_a"),
            call("call_b"),
            output("call_a"),
            output("call_b"),
        ];
        reorder_tool_pairs(&mut input);
        assert_eq!(input[0]["call_id"], "call_a");
        assert_eq!(input[1]["call_id"], "call_a");
        assert_eq!(input[2]["call_id"], "call_b");
        assert_eq!(input[3]["call_id"], "call_b");
        assert_eq!(input[0]["type"], "function_call");
        assert_eq!(input[1]["type"], "function_call_output");
        assert_eq!(input[2]["type"], "function_call");
        assert_eq!(input[3]["type"], "function_call_output");
    }

    #[test]
    fn leaves_orphan_call_untouched() {
        let mut input = vec![call("orphan"), user_msg("hi")];
        reorder_tool_pairs(&mut input);
        assert_eq!(input[0]["type"], "function_call");
        assert_eq!(input[1]["type"], "message");
    }

    #[test]
    fn hoists_output_past_reasoning_and_messages() {
        let mut input = vec![
            call("call_1"),
            user_msg("mid"),
            output("call_1"),
        ];
        reorder_tool_pairs(&mut input);
        assert_eq!(input[0]["type"], "function_call");
        assert_eq!(input[1]["type"], "function_call_output");
        assert_eq!(input[2]["type"], "message");
    }
}
