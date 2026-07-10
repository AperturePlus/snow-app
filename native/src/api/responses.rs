use std::collections::HashMap;
use std::path::PathBuf;
use std::pin::Pin;

use async_openai::{config::OpenAIConfig, error::OpenAIError, Client};
use futures::{Stream, StreamExt};
use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;

use crate::api::config::{
    normalize_base_url, resolve_sdk_api_base_url, DEFAULT_OPENAI_BASE_URL,
};
use crate::api::conversation::{prepare_context_request, ConversationContextRequest};
use crate::storage::services::chat_conversations::{
    store_chat_exchange, ChatContextMessage, ChatTokenUsage, StoreChatExchangeInput,
};
use crate::storage::ApiConfigRecord;

#[napi(object)]
pub struct ResponsesApiMessage {
    pub role: String,
    pub content: String,
}

#[napi(object)]
pub struct ResponsesApiRequest {
    pub messages: Vec<ResponsesApiMessage>,
    pub model: Option<String>,
    pub conversation_id: Option<String>,
    pub previous_response_id: Option<String>,
    pub directory_id: Option<String>,
    pub checkpoint_id: Option<String>,
}

#[napi(object)]
pub struct TokenUsage {
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_creation_input_tokens: i64,
    pub cache_read_input_tokens: i64,
}

#[napi(object)]
pub struct ResponsesApiResult {
    pub id: String,
    pub conversation_id: String,
    pub content: String,
    pub thinking: String,
    pub model: String,
    pub status: String,
    pub tool_calls_json: String,
    pub token_usage: TokenUsage,
}

#[napi(object)]
pub struct ResponsesApiStreamChunk {
    pub content_delta: String,
    pub thinking_delta: String,
    pub content: String,
    pub thinking: String,
}

/// ThreadsafeFunction variant of the streaming callback.
///
/// Using `CalleeHandled = false` so the JavaScript callback receives the chunk
/// directly as its first argument (no error-first `null`), matching the existing
/// `(chunk: ResponsesApiStreamChunk) => void` signature on the JS side.
///
/// `ThreadsafeFunction` is `Send + Sync`, which allows it to be called from the
/// background tokio worker thread without blocking the Node.js main thread.
pub type ResponsesApiStreamCallback =
    ThreadsafeFunction<ResponsesApiStreamChunk, Unknown<'static>, ResponsesApiStreamChunk, Status, false>;

pub async fn create_response_stream_with_context(
    request: ResponsesApiRequest,
    database_path: PathBuf,
    api_config: ApiConfigRecord,
    custom_headers: HashMap<String, String>,
    on_chunk: ResponsesApiStreamCallback,
    cancel_token: CancellationToken,
) -> Result<ResponsesApiResult> {
    create_response_async(
        request,
        database_path,
        api_config,
        custom_headers,
        &on_chunk,
        cancel_token,
    )
    .await
}

async fn create_response_async(
    request: ResponsesApiRequest,
    database_path: PathBuf,
    api_config: ApiConfigRecord,
    custom_headers: HashMap<String, String>,
    on_chunk: &ResponsesApiStreamCallback,
    cancel_token: CancellationToken,
) -> Result<ResponsesApiResult> {
    if api_config.request_method != "responses" {
        return Err(Error::from_reason(
            "Only OpenAI Responses API is supported for chat right now. Please switch the active API request method to Responses.",
        ));
    }

    let api_key = api_config.api_key.trim();
    if api_key.is_empty() {
        return Err(Error::from_reason(
            "API key not configured. Please configure API settings first.",
        ));
    }

    let base_url = resolve_effective_base_url(&api_config);
    if base_url.is_empty() {
        return Err(Error::from_reason(
            "Base URL not configured. Please configure API settings first.",
        ));
    }

    let request_messages = request
        .messages
        .iter()
        .map(|message| ChatContextMessage {
            role: message.role.clone(),
            content: message.content.clone(),
        })
        .collect::<Vec<_>>();
    let prepared_request = prepare_context_request(ConversationContextRequest {
        database_path: &database_path,
        conversation_id: request.conversation_id.as_deref(),
        previous_response_id: request.previous_response_id.as_deref(),
        messages: &request_messages,
        max_context_tokens: api_config.max_context_tokens,
        directory_id: request.directory_id.as_deref(),
    })?;

    let client = build_openai_client(&base_url, api_key, &custom_headers)?;
    let payload = build_responses_payload(&prepared_request.messages, &request, &api_config)?;
    let streamed_response = collect_streaming_response(&client, payload, on_chunk, &cancel_token).await?;
    let raw_response_json = serde_json::to_string(&streamed_response.raw_events)
        .unwrap_or_else(|_| "[]".to_string());

    store_chat_exchange(
        &database_path,
        &StoreChatExchangeInput {
            conversation_id: &prepared_request.conversation_id,
            request_messages: &prepared_request.current_messages,
            response_content: &streamed_response.content,
            response_id: &streamed_response.id,
            checkpoint_id: request.checkpoint_id.as_deref().unwrap_or(""),
            model: &streamed_response.model,
            status: &streamed_response.status,
            raw_response_json: &raw_response_json,
            token_usage: streamed_response.token_usage,
            response_thinking: &streamed_response.thinking,
            tool_calls_json: &streamed_response.tool_calls_json,
            directory_id: request.directory_id.as_deref().unwrap_or(""),
        },
    )?;

    Ok(ResponsesApiResult {
        id: streamed_response.id,
        conversation_id: prepared_request.conversation_id,
        content: streamed_response.content,
        thinking: streamed_response.thinking,
        model: streamed_response.model,
        status: streamed_response.status,
        tool_calls_json: streamed_response.tool_calls_json,
        token_usage: TokenUsage {
            input_tokens: streamed_response.token_usage.input_tokens,
            output_tokens: streamed_response.token_usage.output_tokens,
            cache_creation_input_tokens: streamed_response.token_usage.cache_creation_input_tokens,
            cache_read_input_tokens: streamed_response.token_usage.cache_read_input_tokens,
        },
    })
}

fn resolve_effective_base_url(api_config: &ApiConfigRecord) -> String {
    let normalized_base_url = normalize_base_url(&api_config.base_url);
    let base_url = if normalized_base_url == DEFAULT_OPENAI_BASE_URL {
        DEFAULT_OPENAI_BASE_URL.to_string()
    } else {
        normalized_base_url
    };

    resolve_sdk_api_base_url(&base_url, &api_config.base_url_mode)
}

fn build_openai_client(
    base_url: &str,
    api_key: &str,
    custom_headers: &HashMap<String, String>,
) -> Result<Client<OpenAIConfig>> {
    let config = OpenAIConfig::new()
        .with_api_key(api_key)
        .with_api_base(base_url);
    let mut default_headers = HeaderMap::new();

    for (key, value) in custom_headers {
        let trimmed_key = key.trim();
        let trimmed_value = value.trim();
        if trimmed_key.is_empty() || trimmed_value.is_empty() {
            continue;
        }

        if trimmed_key.eq_ignore_ascii_case("content-type")
            || trimmed_key.eq_ignore_ascii_case("accept-encoding")
        {
            continue;
        }

        let header_name = trimmed_key.parse::<HeaderName>().map_err(|error| {
            Error::from_reason(format!("Invalid custom header '{}': {}", trimmed_key, error))
        })?;
        let header_value = HeaderValue::from_str(trimmed_value).map_err(|error| {
            Error::from_reason(format!("Invalid custom header value for '{}': {}", trimmed_key, error))
        })?;
        default_headers.insert(header_name, header_value);
    }

    let http_client = reqwest::Client::builder()
        .default_headers(default_headers)
        .build()
        .map_err(|error| Error::from_reason(format!("Failed to create HTTP client: {}", error)))?;

    Ok(Client::with_config(config).with_http_client(http_client))
}

fn build_responses_payload(
    messages: &[ChatContextMessage],
    request: &ResponsesApiRequest,
    api_config: &ApiConfigRecord,
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

    let input = messages
        .iter()
        .filter_map(|message| {
            let content = message.content.trim();
            if content.is_empty() {
                return None;
            }

            Some(json!({
                "type": "message",
                "role": normalize_message_role(&message.role),
                "content": content,
            }))
        })
        .collect::<Vec<_>>();

    if input.is_empty() {
        return Err(Error::from_reason("Chat message content is required"));
    }

    let mut payload = json!({
        "model": model,
        "input": input,
        "stream": true,
    });

    if let Some(max_tokens) = api_config.max_tokens {
        if max_tokens > 0 {
            payload["max_output_tokens"] = json!(max_tokens);
        }
    }

    if let Some(reasoning) = build_responses_reasoning(&api_config.config_json) {
        payload["reasoning"] = reasoning;
    }

    if let Ok(tools) = crate::mcp::tools::tools_as_openai_responses_json() {
        if tools.as_array().is_some_and(|arr| !arr.is_empty()) {
            payload["tools"] = tools;
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

    Some(json!({ "effort": effort }))
}

type ResponseValueStream =
    Pin<Box<dyn Stream<Item = std::result::Result<Value, OpenAIError>> + Send>>;

struct StreamingResponseResult {
    id: String,
    content: String,
    thinking: String,
    model: String,
    status: String,
    token_usage: ChatTokenUsage,
    tool_calls_json: String,
    raw_events: Vec<Value>,
}

async fn collect_streaming_response(
    client: &Client<OpenAIConfig>,
    payload: Value,
    on_chunk: &ResponsesApiStreamCallback,
    cancel_token: &CancellationToken,
) -> Result<StreamingResponseResult> {
    let responses = client.responses();
    let create_stream_future = responses.create_stream_byot::<Value, Value>(payload);

    let mut stream: ResponseValueStream = tokio::select! {
        biased;
        _ = cancel_token.cancelled() => {
            return Ok(StreamingResponseResult {
                id: String::new(),
                content: String::new(),
                thinking: String::new(),
                model: String::new(),
                status: String::from("cancelled"),
                token_usage: ChatTokenUsage {
                    input_tokens: 0,
                    output_tokens: 0,
                    cache_creation_input_tokens: 0,
                    cache_read_input_tokens: 0,
                },
                tool_calls_json: "[]".to_string(),
                raw_events: Vec::new(),
            });
        }
        result = create_stream_future => {
            result.map_err(|error| Error::from_reason(format!("Failed to create response stream: {}", error)))?
        }
    };

    let mut raw_events = Vec::new();
    let mut content_chunks = Vec::new();
    let mut thinking_chunks = Vec::new();
    let mut tool_calls = Vec::new();
    let mut completed_response: Option<Value> = None;
    let mut response_id = String::new();
    let mut response_model = String::new();
    let mut response_status = String::from("completed");
    let mut token_usage = ChatTokenUsage {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
    };

    loop {
        tokio::select! {
            biased;
            _ = cancel_token.cancelled() => {
                response_status = String::from("cancelled");
                break;
            }
            event_result = stream.next() => {
                let Some(event_result) = event_result else {
                    break;
                };

                let event = match event_result {
                    Ok(event) => event,
                    Err(error) if is_stream_ended_error(&error) => break,
                    Err(error) => {
                        return Err(Error::from_reason(format!(
                            "Failed to read response stream: {}",
                            error
                        )));
                    }
                };
                let event_type = event.get("type").and_then(Value::as_str).unwrap_or_default();

                match event_type {
                    "response.output_text.delta" => {
                        let content_delta = read_stream_text_delta(event.get("delta"));
                        if !content_delta.is_empty() {
                            content_chunks.push(content_delta.clone());
                            emit_stream_chunk(on_chunk, content_delta, String::new());
                        }
                    }
                    "response.reasoning_summary_text.delta" => {
                        let thinking_delta = read_stream_text_delta(event.get("delta"));
                        if !thinking_delta.is_empty() {
                            thinking_chunks.push(thinking_delta.clone());
                            emit_stream_chunk(on_chunk, String::new(), thinking_delta);
                        }
                    }
                    "response.reasoning_summary.delta" => {
                        if let Some(delta) = event.get("delta") {
                            let mut delta_chunks = Vec::new();
                            collect_text_values(delta, &mut delta_chunks);
                            let thinking_delta = delta_chunks.join("");
                            if !thinking_delta.is_empty() {
                                thinking_chunks.push(thinking_delta.clone());
                                emit_stream_chunk(on_chunk, String::new(), thinking_delta);
                            }
                        }
                    }
                    "response.output_item.done" => {
                        collect_tool_calls(event.get("item"), &mut tool_calls);
                    }
                    "response.completed" | "response.incomplete" | "response.failed" => {
                        if let Some(response) = event.get("response") {
                            response_id = read_response_string(response, "id").unwrap_or(response_id);
                            response_model = read_response_string(response, "model").unwrap_or(response_model);
                            response_status = read_response_string(response, "status").unwrap_or_else(|| {
                                if event_type == "response.failed" {
                                    "failed".to_string()
                                } else if event_type == "response.incomplete" {
                                    "incomplete".to_string()
                                } else {
                                    response_status.clone()
                                }
                            });
                            token_usage = extract_token_usage(response);
                            completed_response = Some(response.clone());
                        }
                    }
                    "error" => {
                        let message = event
                            .get("message")
                            .and_then(Value::as_str)
                            .unwrap_or("Responses stream failed");
                        return Err(Error::from_reason(message.to_string()));
                    }
                    _ => {}
                }

                raw_events.push(event);
            }
        }
    }

    if let Some(response) = completed_response.as_ref() {
        if content_chunks.is_empty() {
            let content = extract_output_text(response);
            if !content.is_empty() {
                content_chunks.push(content);
            }
        }

        if thinking_chunks.is_empty() {
            let thinking = extract_response_thinking(response);
            if !thinking.is_empty() {
                thinking_chunks.push(thinking);
            }
        }

        if tool_calls.is_empty() {
            collect_tool_calls(response.get("output"), &mut tool_calls);
        }
    }

    let content = content_chunks.join("").trim().to_string();
    let thinking = thinking_chunks.join("").trim().to_string();
    let tool_calls_json = serde_json::to_string(&tool_calls).unwrap_or_else(|_| "[]".to_string());

    Ok(StreamingResponseResult {
        id: response_id,
        content,
        thinking,
        model: response_model,
        status: response_status,
        token_usage,
        tool_calls_json,
        raw_events,
    })
}

fn is_stream_ended_error(error: &OpenAIError) -> bool {
    matches!(error, OpenAIError::StreamError(stream_error) if stream_error.to_string() == "Stream ended")
}

fn read_stream_text_delta(value: Option<&Value>) -> String {
    value
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty())
        .map(ToString::to_string)
        .unwrap_or_default()
}

/// Emit a streaming chunk to the JavaScript side via ThreadsafeFunction.
///
/// Only the delta strings are sent; the `content` and `thinking` fields are
/// left empty to avoid O(n^2) data transfer. The renderer accumulates deltas
/// locally and the final complete text arrives via the resolved Promise.
fn emit_stream_chunk(
    on_chunk: &ResponsesApiStreamCallback,
    content_delta: String,
    thinking_delta: String,
) {
    if content_delta.is_empty() && thinking_delta.is_empty() {
        return;
    }

    on_chunk.call(
        ResponsesApiStreamChunk {
            content_delta,
            thinking_delta,
            content: String::new(),
            thinking: String::new(),
        },
        ThreadsafeFunctionCallMode::NonBlocking,
    );
}

fn extract_token_usage(response: &Value) -> ChatTokenUsage {
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
            ],
        ),
        cache_read_input_tokens: read_first_i64(
            usage,
            &[
                &["cache_read_input_tokens"],
                &["prompt_cache_hit_tokens"],
                &["cached_tokens"],
                &["input_tokens_details", "cache_read_input_tokens"],
                &["input_tokens_details", "cached_tokens"],
            ],
        ),
    }
}

fn extract_response_thinking(response: &Value) -> String {
    let mut chunks = Vec::new();
    collect_reasoning_text(response.get("output"), &mut chunks);
    chunks.join("\n").trim().to_string()
}

fn read_first_i64(value: &Value, paths: &[&[&str]]) -> i64 {
    paths
        .iter()
        .find_map(|path| read_path_i64(value, path).filter(|number| *number > 0))
        .unwrap_or(0)
}

fn read_path_i64(value: &Value, path: &[&str]) -> Option<i64> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    value_as_i64(current)
}

fn value_as_i64(value: &Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_u64().and_then(|number| i64::try_from(number).ok()))
        .or_else(|| value.as_f64().map(|number| number as i64))
}

fn collect_reasoning_text(value: Option<&Value>, chunks: &mut Vec<String>) {
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

fn collect_text_values(value: &Value, chunks: &mut Vec<String>) {
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

fn collect_tool_calls(value: Option<&Value>, calls: &mut Vec<Value>) {
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

fn read_response_string(response: &Value, key: &str) -> Option<String> {
    response
        .get(key)
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

fn extract_output_text(response: &Value) -> String {
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

fn collect_output_text(value: Option<&Value>, chunks: &mut Vec<String>) {
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
