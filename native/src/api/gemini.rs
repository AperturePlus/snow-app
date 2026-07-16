use std::collections::HashMap;
use std::path::{Path, PathBuf};

use futures::StreamExt;
use napi::bindgen_prelude::*;
use napi::threadsafe_function::ThreadsafeFunctionCallMode;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, ACCEPT_ENCODING, CONTENT_TYPE};
use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;

use crate::api::config::{
    normalize_base_url, resolve_sdk_api_base_url, DEFAULT_GEMINI_BASE_URL, DEFAULT_OPENAI_BASE_URL,
};
use crate::api::conversation::{
    parse_chat_message_content, prepare_context_request, resolve_sub_agent_tools,
    ConversationContextRequest,
};
use crate::api::responses::{
    ResponsesApiRequest, ResponsesApiResult, ResponsesApiStreamCallback, ResponsesApiStreamChunk,
    TokenUsage,
};
use crate::api::retry::{RetryOptions, should_retry, wait_before_retry};
use crate::storage::services::chat_conversations::{
    store_chat_exchange, ChatContextMessage, ChatTokenUsage, StoreChatExchangeInput,
};
use crate::storage::ApiConfigRecord;

pub async fn create_gemini_response_stream(
    request: ResponsesApiRequest,
    database_path: PathBuf,
    api_config: ApiConfigRecord,
    custom_headers: HashMap<String, String>,
    on_chunk: ResponsesApiStreamCallback,
    cancel_token: CancellationToken,
) -> Result<ResponsesApiResult> {
    create_gemini_response_async(
        request,
        database_path,
        api_config,
        custom_headers,
        &on_chunk,
        cancel_token,
    )
    .await
}

async fn create_gemini_response_async(
    request: ResponsesApiRequest,
    database_path: PathBuf,
    api_config: ApiConfigRecord,
    custom_headers: HashMap<String, String>,
    on_chunk: &ResponsesApiStreamCallback,
    cancel_token: CancellationToken,
) -> Result<ResponsesApiResult> {
    if request.messages.is_empty() {
        return Err(Error::from_reason("At least one chat message is required"));
    }

    let api_key = api_config.api_key.trim();
    if api_key.is_empty() {
        return Err(Error::from_reason(
            "API key not configured. Please configure API settings first.",
        ));
    }

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

    let endpoint = resolve_gemini_endpoint(&api_config, &model, api_key);
    if endpoint.is_empty() {
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
        context_compaction: request.context_compaction.unwrap_or(false),
    })?;

    let client = reqwest::Client::builder()
        .build()
        .map_err(|error| Error::from_reason(format!("Failed to create HTTP client: {}", error)))?;
    let tools = if request.context_compaction.unwrap_or(false) {
        None
    } else {
        match resolve_sub_agent_tools(&request).await {
            Ok(tools) => Some(crate::mcp::tools::tools_as_gemini_json(&tools)),
            Err(error) => {
                eprintln!("Failed to prepare MCP tools for Gemini: {error}");
                None
            }
        }
    };
    let payload = build_gemini_payload(
        &prepared_request.messages,
        &database_path,
        &request,
        &api_config,
        tools,
    )?;
    let retry_options = RetryOptions::from_config(api_config.max_retries, api_config.retry_base_delay_ms);
    let streamed_response = collect_gemini_stream(
        &client,
        &endpoint,
        &custom_headers,
        payload,
        on_chunk,
        &cancel_token,
        &retry_options,
    )
    .await?;
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
            context_compaction: request.context_compaction.unwrap_or(false),
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

fn resolve_gemini_endpoint(api_config: &ApiConfigRecord, model: &str, api_key: &str) -> String {
    let normalized_base_url = normalize_base_url(&api_config.base_url);
    if normalized_base_url.is_empty() {
        return String::new();
    }

    let base_url = if normalized_base_url == DEFAULT_OPENAI_BASE_URL {
        DEFAULT_GEMINI_BASE_URL.to_string()
    } else {
        normalized_base_url
    };

    let resolved_base = if api_config.base_url_mode == "endpoint" {
        base_url
    } else {
        resolve_sdk_api_base_url(&base_url, &api_config.base_url_mode)
    };

    let clean_model = model.strip_prefix("models/").unwrap_or(model);

    let mut url = format!(
        "{}/models/{}:streamGenerateContent?alt=sse",
        resolved_base, clean_model
    );

    if !api_key.is_empty() {
        url.push_str(&format!("&key={}", api_key));
    }

    url
}

fn build_gemini_payload(
    messages: &[ChatContextMessage],
    database_path: &Path,
    _request: &ResponsesApiRequest,
    api_config: &ApiConfigRecord,
    tools: Option<Value>,
) -> Result<Value> {

    let mut system_parts = Vec::new();
    let mut contents = Vec::new();

    for message in messages {
        let content = message.content.trim();
        if content.is_empty() {
            continue;
        }

        let parsed_content = parse_chat_message_content(content, database_path)?;
        let role = message.role.trim();
        match role {
            "system" | "developer" => {
                if !parsed_content.text.is_empty() {
                    system_parts.push(parsed_content.text);
                }
            }
            _ => {
                let mut parts = Vec::new();
                if !parsed_content.text.is_empty() {
                    parts.push(json!({ "text": parsed_content.text }));
                }
                parts.extend(parsed_content.images.iter().map(|image| {
                    json!({
                        "inlineData": {
                            "mimeType": image.media_type,
                            "data": image.data,
                        },
                    })
                }));

                contents.push(json!({
                    "role": normalize_gemini_role(role),
                    "parts": parts,
                }));
            }
        }
    }

    if contents.is_empty() {
        return Err(Error::from_reason("Chat message content is required"));
    }

    let mut payload = json!({
        "contents": contents,
    });

    if !system_parts.is_empty() {
        payload["systemInstruction"] = json!({
            "parts": [{"text": system_parts.join("\n")}],
        });
    }

    let mut generation_config = json!({});

    if let Some(max_tokens) = api_config.max_tokens {
        if max_tokens > 0 {
            generation_config["maxOutputTokens"] = json!(max_tokens);
        }
    }

    if let Some(thinking_config) = build_gemini_thinking_config(&api_config.config_json) {
        generation_config["thinkingConfig"] = thinking_config;
    }

    if generation_config
        .as_object()
        .is_some_and(|object| !object.is_empty())
    {
        payload["generationConfig"] = generation_config;
    }

    if let Some(tools) = tools {
        if tools
            .get("functionDeclarations")
            .and_then(Value::as_array)
            .is_some_and(|items| !items.is_empty())
        {
            payload["tools"] = json!([tools]);
        }
    }

    Ok(payload)
}

fn normalize_gemini_role(role: &str) -> &str {
    match role.trim() {
        "assistant" => "model",
        _ => "user",
    }
}

fn build_gemini_thinking_config(config_json: &str) -> Option<Value> {
    let parsed = serde_json::from_str::<Value>(config_json).ok()?;
    let gemini_thinking = parsed
        .get("snowcfg")?
        .get("geminiThinking")?
        .as_object()?;
    let enabled = gemini_thinking
        .get("enabled")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    if !enabled {
        return None;
    }

    let thinking_level = gemini_thinking
        .get("thinkingLevel")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != "none")?;

    Some(json!({ "thinkingLevel": thinking_level }))
}

struct GeminiStreamResult {
    id: String,
    content: String,
    thinking: String,
    model: String,
    status: String,
    token_usage: ChatTokenUsage,
    tool_calls_json: String,
    raw_events: Vec<Value>,
}

async fn collect_gemini_stream(
    client: &reqwest::Client,
    endpoint: &str,
    custom_headers: &HashMap<String, String>,
    payload: Value,
    on_chunk: &ResponsesApiStreamCallback,
    cancel_token: &CancellationToken,
    retry_options: &RetryOptions,
) -> Result<GeminiStreamResult> {
    let mut attempt: u32 = 0;
    let response = loop {
        if cancel_token.is_cancelled() {
            return Ok(GeminiStreamResult {
                id: String::new(),
                content: String::new(),
                thinking: String::new(),
                model: String::new(),
                status: String::from("cancelled"),
                token_usage: ChatTokenUsage::default(),
                tool_calls_json: "[]".to_string(),
                raw_events: Vec::new(),
            });
        }

        let send_future = client
            .post(endpoint)
            .headers(build_header_map(custom_headers)?)
            .json(&payload)
            .send();

        let result = tokio::select! {
            biased;
            _ = cancel_token.cancelled() => {
                return Ok(GeminiStreamResult {
                    id: String::new(),
                    content: String::new(),
                    thinking: String::new(),
                    model: String::new(),
                    status: String::from("cancelled"),
                    token_usage: ChatTokenUsage::default(),
                    tool_calls_json: "[]".to_string(),
                    raw_events: Vec::new(),
                });
            }
            result = send_future => {
                result.map_err(|error| Error::from_reason(format!("Failed to create Gemini stream: {}", error)))
            }
        };

        match result {
            Ok(response) => {
                let status = response.status();
                if !status.is_success() {
                    let error_body = response.text().await.unwrap_or_default();
                    let error = Error::from_reason(format!(
                        "Gemini streamGenerateContent request failed: {} {}",
                        status, error_body
                    ));

                    if !should_retry(&error, attempt, retry_options) {
                        return Err(error);
                    }

                    // Emit retry status to frontend
                    on_chunk.call(
                        ResponsesApiStreamChunk {
                            content_delta: String::new(),
                            thinking_delta: String::new(),
                            content: String::new(),
                            thinking: String::new(),
                            retrying: true,
                            retry_attempt: Some((attempt + 1) as i32),
                            retry_error: Some(error.reason.clone()),
                        },
                        ThreadsafeFunctionCallMode::NonBlocking,
                    );

                    match wait_before_retry(retry_options, cancel_token).await {
                        Ok(()) => { attempt += 1; continue; }
                        Err(e) => return Err(e),
                    }
                }
                break response;
            }
            Err(error) => {
                if !should_retry(&error, attempt, retry_options) {
                    return Err(error);
                }

                // Emit retry status to frontend
                on_chunk.call(
                    ResponsesApiStreamChunk {
                        content_delta: String::new(),
                        thinking_delta: String::new(),
                        content: String::new(),
                        thinking: String::new(),
                        retrying: true,
                    retry_attempt: Some((attempt + 1) as i32),
                    retry_error: Some(error.reason.clone()),
                },
                ThreadsafeFunctionCallMode::NonBlocking,
            );

                match wait_before_retry(retry_options, cancel_token).await {
                    Ok(()) => { attempt += 1; continue; }
                    Err(e) => return Err(e),
                }
            }
        }
    };

    let mut raw_events = Vec::new();
    let mut content_chunks = Vec::new();
    let mut thinking_chunks = Vec::new();
    let mut tool_calls = Vec::new();
    let mut response_id = String::new();
    let mut response_model = String::new();
    let mut response_status = String::from("completed");
    let mut token_usage = ChatTokenUsage::default();
    let mut buffer = String::new();
    let mut stream = response.bytes_stream();
    loop {
        tokio::select! {
            biased;
            _ = cancel_token.cancelled() => {
                response_status = String::from("cancelled");
                break;
            }
            chunk_result = stream.next() => {
                let Some(chunk_result) = chunk_result else {
                    break;
                };

                let chunk = chunk_result
                    .map_err(|error| Error::from_reason(format!("Failed to read Gemini stream: {}", error)))?;
                buffer.push_str(&String::from_utf8_lossy(&chunk));

                while let Some(separator_index) = buffer.find("\n\n") {
                    let event_block = buffer[..separator_index].to_string();
                    buffer = buffer[separator_index + 2..].to_string();
                    let content_start_index = content_chunks.len();
                    let thinking_start_index = thinking_chunks.len();
                    process_gemini_sse_event_block(
                        &event_block,
                        &mut raw_events,
                        &mut content_chunks,
                        &mut thinking_chunks,
                        &mut tool_calls,
                        &mut response_id,
                        &mut response_model,
                        &mut response_status,
                        &mut token_usage,
                    )?;
                    let content_delta = content_chunks[content_start_index..].join("");
                    let thinking_delta = thinking_chunks[thinking_start_index..].join("");
                    emit_stream_chunk(on_chunk, content_delta, thinking_delta);
                }
            }
        }
    }

    if response_status != "cancelled" && !buffer.trim().is_empty() {
        let content_start_index = content_chunks.len();
        let thinking_start_index = thinking_chunks.len();
        process_gemini_sse_event_block(
            &buffer,
            &mut raw_events,
            &mut content_chunks,
            &mut thinking_chunks,
            &mut tool_calls,
            &mut response_id,
            &mut response_model,
            &mut response_status,
            &mut token_usage,
        )?;
        let content_delta = content_chunks[content_start_index..].join("");
        let thinking_delta = thinking_chunks[thinking_start_index..].join("");
        emit_stream_chunk(on_chunk, content_delta, thinking_delta);
    }

    let content = content_chunks.join("").trim().to_string();
    let thinking = thinking_chunks.join("").trim().to_string();
    let tool_calls_json = serde_json::to_string(&tool_calls).unwrap_or_else(|_| "[]".to_string());

    Ok(GeminiStreamResult {
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

#[allow(clippy::too_many_arguments)]
fn process_gemini_sse_event_block(
    event_block: &str,
    raw_events: &mut Vec<Value>,
    content_chunks: &mut Vec<String>,
    thinking_chunks: &mut Vec<String>,
    tool_calls: &mut Vec<Value>,
    response_id: &mut String,
    response_model: &mut String,
    response_status: &mut String,
    token_usage: &mut ChatTokenUsage,
) -> Result<()> {
    let data = event_block
        .lines()
        .filter_map(|line| line.trim_start().strip_prefix("data:"))
        .map(str::trim_start)
        .collect::<Vec<_>>()
        .join("\n");

    if data.trim().is_empty() {
        return Ok(());
    }

    let event = serde_json::from_str::<Value>(&data).map_err(|error| {
        Error::from_reason(format!("Failed to parse Gemini stream event: {}", error))
    })?;
    process_gemini_event(
        &event,
        content_chunks,
        thinking_chunks,
        tool_calls,
        response_id,
        response_model,
        response_status,
        token_usage,
    )?;
    raw_events.push(event);

    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn process_gemini_event(
    event: &Value,
    content_chunks: &mut Vec<String>,
    thinking_chunks: &mut Vec<String>,
    tool_calls: &mut Vec<Value>,
    response_id: &mut String,
    response_model: &mut String,
    response_status: &mut String,
    token_usage: &mut ChatTokenUsage,
) -> Result<()> {
    if let Some(error) = event.get("error") {
        let message = error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("Gemini stream failed");
        return Err(Error::from_reason(message.to_string()));
    }

    if let Some(id) = read_string(event, "responseId") {
        *response_id = id;
    }
    if let Some(model) = read_string(event, "modelVersion") {
        *response_model = model;
    }

    if let Some(usage) = event
        .get("usageMetadata")
        .filter(|value| !value.is_null())
    {
        token_usage.input_tokens = read_first_i64(usage, &[&["promptTokenCount"]]);
        token_usage.output_tokens = read_first_i64(usage, &[
            &["candidatesTokenCount"],
            &["totalTokenCount"],
        ]);
        token_usage.cache_read_input_tokens =
            read_first_i64(usage, &[&["cachedContentTokenCount"]]);
    }

    if let Some(prompt_feedback) = event.get("promptFeedback") {
        if let Some(block_reason) = prompt_feedback
            .get("blockReason")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
        {
            *response_status = block_reason.to_lowercase();
            return Ok(());
        }
    }

    if let Some(candidates) = event.get("candidates").and_then(Value::as_array) {
        for candidate in candidates {
            if let Some(content) = candidate.get("content") {
                if let Some(parts) = content.get("parts").and_then(Value::as_array) {
                    for part in parts {
                        let is_thought = part
                            .get("thought")
                            .and_then(Value::as_bool)
                            .unwrap_or(false);

                        if let Some(text) = part
                            .get("text")
                            .and_then(Value::as_str)
                            .filter(|text| !text.is_empty())
                        {
                            if is_thought {
                                thinking_chunks.push(text.to_string());
                            } else {
                                content_chunks.push(text.to_string());
                            }
                        }

                        if let Some(function_call) = part.get("functionCall") {
                            tool_calls.push(function_call.clone());
                        }
                    }
                }
            }

            if let Some(finish_reason) = candidate
                .get("finishReason")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
            {
                *response_status = match finish_reason {
                    "STOP" => "completed".to_string(),
                    "MAX_TOKENS" => "max_tokens".to_string(),
                    other => other.to_lowercase(),
                };
            }
        }
    }

    Ok(())
}

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
            retrying: false,
            retry_attempt: None,
            retry_error: None,
        },
        ThreadsafeFunctionCallMode::NonBlocking,
    );
}

fn build_header_map(custom_headers: &HashMap<String, String>) -> Result<HeaderMap> {
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert(ACCEPT_ENCODING, HeaderValue::from_static("identity"));

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
            Error::from_reason(format!(
                "Invalid custom header value for '{}': {}",
                trimmed_key, error
            ))
        })?;
        headers.insert(header_name, header_value);
    }

    Ok(headers)
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

fn read_string(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(ToString::to_string)
}
