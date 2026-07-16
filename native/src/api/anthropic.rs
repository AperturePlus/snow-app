use std::collections::HashMap;
use std::path::{Path, PathBuf};

use futures::StreamExt;
use napi::bindgen_prelude::*;
use napi::threadsafe_function::ThreadsafeFunctionCallMode;
use reqwest::header::{
    HeaderMap, HeaderName, HeaderValue, ACCEPT_ENCODING, AUTHORIZATION, CONTENT_TYPE,
};
use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;

use crate::api::config::{
    normalize_base_url, resolve_sdk_api_base_url, DEFAULT_ANTHROPIC_BASE_URL, DEFAULT_OPENAI_BASE_URL,
};
use crate::api::conversation::{
    parse_chat_message_content, prepare_context_request, ConversationContextRequest,
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

const DEFAULT_MAX_TOKENS: i32 = 64000;

pub async fn create_anthropic_response_stream(
    request: ResponsesApiRequest,
    database_path: PathBuf,
    api_config: ApiConfigRecord,
    custom_headers: HashMap<String, String>,
    on_chunk: ResponsesApiStreamCallback,
    cancel_token: CancellationToken,
) -> Result<ResponsesApiResult> {
    create_anthropic_response_async(
        request,
        database_path,
        api_config,
        custom_headers,
        &on_chunk,
        cancel_token,
    )
    .await
}

async fn create_anthropic_response_async(
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

    let endpoint = resolve_anthropic_endpoint(&api_config);
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
        match crate::mcp::tools::collect_all_mcp_tools(request.directory_id.as_deref()).await {
            Ok(tools) => Some(crate::mcp::tools::tools_as_anthropic_json(&tools)),
            Err(error) => {
                eprintln!("Failed to prepare MCP tools for Anthropic: {error}");
                None
            }
        }
    };
    let payload = build_anthropic_payload(
        &prepared_request.messages,
        &database_path,
        &request,
        &api_config,
        tools,
    )?;
    let retry_options = RetryOptions::from_config(api_config.max_retries, api_config.retry_base_delay_ms);
    let streamed_response = collect_anthropic_stream(
        &client,
        &endpoint,
        api_key,
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

fn resolve_anthropic_endpoint(api_config: &ApiConfigRecord) -> String {
    let normalized_base_url = normalize_base_url(&api_config.base_url);
    if normalized_base_url.is_empty() {
        return String::new();
    }

    let base_url = if normalized_base_url == DEFAULT_OPENAI_BASE_URL {
        DEFAULT_ANTHROPIC_BASE_URL.to_string()
    } else {
        normalized_base_url
    };

    if api_config.base_url_mode == "endpoint" {
        return base_url;
    }

    let resolved_base = resolve_sdk_api_base_url(&base_url, &api_config.base_url_mode);
    format!("{}/messages", resolved_base)
}

fn build_anthropic_payload(
    messages: &[ChatContextMessage],
    database_path: &Path,
    request: &ResponsesApiRequest,
    api_config: &ApiConfigRecord,
    tools: Option<Value>,
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

    let mut system_parts = Vec::new();
    let mut anthropic_messages = Vec::new();

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
                let content = if parsed_content.images.is_empty() {
                    Value::String(parsed_content.text)
                } else {
                    let mut blocks = Vec::new();
                    if !parsed_content.text.is_empty() {
                        blocks.push(json!({ "type": "text", "text": parsed_content.text }));
                    }
                    blocks.extend(parsed_content.images.iter().map(|image| {
                        json!({
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": image.media_type,
                                "data": image.data,
                            },
                        })
                    }));
                    Value::Array(blocks)
                };

                anthropic_messages.push(json!({
                    "role": normalize_anthropic_role(role),
                    "content": content,
                }));
            }
        }
    }

    if anthropic_messages.is_empty() {
        return Err(Error::from_reason("Chat message content is required"));
    }

    let max_tokens = api_config
        .max_tokens
        .filter(|&v| v > 0)
        .unwrap_or(DEFAULT_MAX_TOKENS);

    let mut payload = json!({
        "model": model,
        "max_tokens": max_tokens,
        "messages": anthropic_messages,
        "stream": true,
    });

    // Build system as an array of text blocks with cache_control on the last
    // block, matching the Anthropic prompt-caching best practice used in
    // snow-cli.  A plain string system field cannot carry cache_control.
    if !system_parts.is_empty() {
        let system_blocks: Vec<Value> = system_parts
            .iter()
            .enumerate()
            .map(|(index, text)| {
                let mut block = json!({ "type": "text", "text": text });
                if index == system_parts.len() - 1 {
                    block["cache_control"] = json!({ "type": "ephemeral", "ttl": "5m" });
                }
                block
            })
            .collect();
        payload["system"] = json!(system_blocks);
    }

    // Add metadata.user_id for tracking and caching (matches snow-cli behavior).
    payload["metadata"] = json!({ "user_id": "snow-app-user" });

    if let Some(thinking) = build_anthropic_thinking(&api_config.config_json) {
        payload["thinking"] = thinking;
    }

    if let Some(tools) = tools {
        if tools.as_array().is_some_and(|items| !items.is_empty()) {
            payload["tools"] = tools;
        }
    }

    // Add cache_control to the last user message's last content block.
    // This enables Anthropic to cache the conversation prefix up to and
    // including the last user turn, so subsequent tool-call rounds benefit
    // from cache hits.  Matches snow-cli's convertToAnthropicMessages logic.
    if let Some(messages) = payload.get_mut("messages").and_then(Value::as_array_mut) {
        for msg in messages.iter_mut().rev() {
            if msg.get("role").and_then(Value::as_str) == Some("user") {
                match msg.get_mut("content") {
                    Some(Value::String(_)) => {
                        // Convert plain string content to structured array
                        // so we can attach cache_control.
                        let text = msg["content"].as_str().unwrap_or("").to_string();
                        msg["content"] = json!([
                            {
                                "type": "text",
                                "text": text,
                                "cache_control": { "type": "ephemeral", "ttl": "5m" }
                            }
                        ]);
                    }
                    Some(Value::Array(arr)) => {
                        if let Some(last_block) = arr.last_mut() {
                            last_block["cache_control"] =
                                json!({ "type": "ephemeral", "ttl": "5m" });
                        }
                    }
                    _ => {}
                }
                break;
            }
        }
    }

    Ok(payload)
}

fn normalize_anthropic_role(role: &str) -> &str {
    match role.trim() {
        "assistant" => "assistant",
        _ => "user",
    }
}

fn build_anthropic_thinking(config_json: &str) -> Option<Value> {
    let parsed = serde_json::from_str::<Value>(config_json).ok()?;
    let thinking = parsed.get("snowcfg")?.get("thinking")?.as_object()?;
    let enabled = thinking
        .get("enabled")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    if !enabled {
        return None;
    }

    let effort = thinking
        .get("effort")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != "none")?;
    let _ = effort;

    Some(json!({ "type": "adaptive" }))
}

struct AnthropicStreamResult {
    id: String,
    content: String,
    thinking: String,
    model: String,
    status: String,
    token_usage: ChatTokenUsage,
    tool_calls_json: String,
    raw_events: Vec<Value>,
}

async fn collect_anthropic_stream(
    client: &reqwest::Client,
    endpoint: &str,
    api_key: &str,
    custom_headers: &HashMap<String, String>,
    payload: Value,
    on_chunk: &ResponsesApiStreamCallback,
    cancel_token: &CancellationToken,
    retry_options: &RetryOptions,
) -> Result<AnthropicStreamResult> {
    let mut attempt: u32 = 0;
    let response = loop {
        if cancel_token.is_cancelled() {
            return Ok(AnthropicStreamResult {
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
            .headers(build_header_map(api_key, custom_headers)?)
            .json(&payload)
            .send();

        let result = tokio::select! {
            biased;
            _ = cancel_token.cancelled() => {
                return Ok(AnthropicStreamResult {
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
                result.map_err(|error| Error::from_reason(format!("Failed to create Anthropic stream: {}", error)))
            }
        };

        match result {
            Ok(response) => {
                let status = response.status();
                if !status.is_success() {
                    let error_body = response.text().await.unwrap_or_default();
                    let error = Error::from_reason(format!(
                        "Anthropic messages request failed: {} {}",
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
    let mut tool_call_positions_by_index: HashMap<usize, usize> = HashMap::new();
    let mut tool_input_json_by_index: HashMap<usize, String> = HashMap::new();
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
                    .map_err(|error| Error::from_reason(format!("Failed to read Anthropic stream: {}", error)))?;
                buffer.push_str(&String::from_utf8_lossy(&chunk));

                while let Some(separator_index) = buffer.find("\n\n") {
                    let event_block = buffer[..separator_index].to_string();
                    buffer = buffer[separator_index + 2..].to_string();
                    let content_start_index = content_chunks.len();
                    let thinking_start_index = thinking_chunks.len();
                    process_anthropic_sse_event_block(
                        &event_block,
                        &mut raw_events,
                        &mut content_chunks,
                        &mut thinking_chunks,
                        &mut tool_calls,
                        &mut tool_call_positions_by_index,
                        &mut tool_input_json_by_index,
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
        process_anthropic_sse_event_block(
            &buffer,
            &mut raw_events,
            &mut content_chunks,
            &mut thinking_chunks,
            &mut tool_calls,
            &mut tool_call_positions_by_index,
            &mut tool_input_json_by_index,
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

    // Anthropic returns input_tokens, cache_creation_input_tokens, and
    // cache_read_input_tokens as disjoint values. Normalize so input_tokens
    // includes cache tokens, matching OpenAI/Gemini semantics where
    // prompt_tokens already contains cached_tokens.
    token_usage.input_tokens +=
        token_usage.cache_creation_input_tokens + token_usage.cache_read_input_tokens;

    Ok(AnthropicStreamResult {
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
fn process_anthropic_sse_event_block(
    event_block: &str,
    raw_events: &mut Vec<Value>,
    content_chunks: &mut Vec<String>,
    thinking_chunks: &mut Vec<String>,
    tool_calls: &mut Vec<Value>,
    tool_call_positions_by_index: &mut HashMap<usize, usize>,
    tool_input_json_by_index: &mut HashMap<usize, String>,
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
        Error::from_reason(format!("Failed to parse Anthropic stream event: {}", error))
    })?;
    process_anthropic_event(
        &event,
        content_chunks,
        thinking_chunks,
        tool_calls,
        tool_call_positions_by_index,
        tool_input_json_by_index,
        response_id,
        response_model,
        response_status,
        token_usage,
    )?;
    raw_events.push(event);

    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn process_anthropic_event(
    event: &Value,
    content_chunks: &mut Vec<String>,
    thinking_chunks: &mut Vec<String>,
    tool_calls: &mut Vec<Value>,
    tool_call_positions_by_index: &mut HashMap<usize, usize>,
    tool_input_json_by_index: &mut HashMap<usize, String>,
    response_id: &mut String,
    response_model: &mut String,
    response_status: &mut String,
    token_usage: &mut ChatTokenUsage,
) -> Result<()> {
    let event_type = event.get("type").and_then(Value::as_str).unwrap_or_default();

    match event_type {
        "message_start" => {
            if let Some(message) = event.get("message") {
                if let Some(id) = read_string(message, "id") {
                    *response_id = id;
                }
                if let Some(model) = read_string(message, "model") {
                    *response_model = model;
                }
                if let Some(usage) = message.get("usage").filter(|v| !v.is_null()) {
                    if let Some(input_tokens) = read_path_i64(usage, &["input_tokens"]) {
                        token_usage.input_tokens = input_tokens;
                    }
                    if let Some(cache_creation) =
                        read_path_i64(usage, &["cache_creation_input_tokens"])
                    {
                        token_usage.cache_creation_input_tokens = cache_creation;
                    }
                    if let Some(cache_read) = read_path_i64(usage, &["cache_read_input_tokens"]) {
                        token_usage.cache_read_input_tokens = cache_read;
                    }
                }
            }
        }
        "content_block_start" => {
            if let Some(content_block) = event.get("content_block") {
                let block_type = content_block
                    .get("type")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if block_type == "tool_use" {
                    if let Some(index) = event
                        .get("index")
                        .and_then(Value::as_u64)
                        .and_then(|value| usize::try_from(value).ok())
                    {
                        tool_call_positions_by_index.insert(index, tool_calls.len());
                    }
                    tool_calls.push(content_block.clone());
                }
            }
        }
        "content_block_stop" => {
            // Finalize tool input: parse the accumulated JSON fragments
            // and update the tool_call's "input" field. This is critical
            // because input_json_delta only sets "input" when the
            // accumulated string happens to be valid JSON at an
            // intermediate point — the complete JSON is only available
            // after all deltas have been received.
            if let Some(index) = event
                .get("index")
                .and_then(Value::as_u64)
                .and_then(|value| usize::try_from(value).ok())
            {
                if let Some(accumulated) = tool_input_json_by_index.get(&index) {
                    if let Ok(input) = serde_json::from_str::<Value>(accumulated.as_str()) {
                        if let Some(position) =
                            tool_call_positions_by_index.get(&index).copied()
                        {
                            if let Some(tool_call) = tool_calls
                                .get_mut(position)
                                .and_then(Value::as_object_mut)
                            {
                                tool_call.insert("input".to_string(), input);
                            }
                        }
                    }
                }
            }
        }
        "content_block_delta" => {
            if let Some(delta) = event.get("delta") {
                let delta_type = delta
                    .get("type")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                match delta_type {
                    "text_delta" => {
                        push_trimmed_string(delta.get("text"), content_chunks);
                    }
                    "thinking_delta" => {
                        push_trimmed_string(delta.get("thinking"), thinking_chunks);
                    }
                    "input_json_delta" => {
                        if let Some(index) = event
                            .get("index")
                            .and_then(Value::as_u64)
                            .and_then(|value| usize::try_from(value).ok())
                        {
                            if let Some(partial_json) = delta
                                .get("partial_json")
                                .and_then(Value::as_str)
                                .filter(|value| !value.is_empty())
                            {
                                let input_json = tool_input_json_by_index.entry(index).or_default();
                                input_json.push_str(partial_json);

                                // Best-effort intermediate parse for early UI updates.
                                // The final, authoritative parse happens in content_block_stop.
                                if let Ok(input) = serde_json::from_str::<Value>(input_json.as_str()) {
                                    if let Some(position) =
                                        tool_call_positions_by_index.get(&index).copied()
                                    {
                                        if let Some(tool_call) = tool_calls
                                            .get_mut(position)
                                            .and_then(Value::as_object_mut)
                                        {
                                            tool_call.insert("input".to_string(), input);
                                        }
                                    }
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
        "message_delta" => {
            if let Some(delta) = event.get("delta") {
                if let Some(stop_reason) = delta
                    .get("stop_reason")
                    .and_then(Value::as_str)
                    .filter(|value| !value.is_empty())
                {
                    *response_status = if stop_reason == "end_turn" {
                        "completed".to_string()
                    } else {
                        stop_reason.to_string()
                    };
                }
            }
            if let Some(usage) = event.get("usage").filter(|v| !v.is_null()) {
                if let Some(output_tokens) = read_path_i64(usage, &["output_tokens"]) {
                    token_usage.output_tokens = output_tokens;
                }
                if let Some(input_tokens) = read_path_i64(usage, &["input_tokens"]).filter(|n| *n > 0) {
                    token_usage.input_tokens = input_tokens;
                }
                if let Some(cache_creation) =
                    read_path_i64(usage, &["cache_creation_input_tokens"]).filter(|n| *n > 0)
                {
                    token_usage.cache_creation_input_tokens = cache_creation;
                }
                if let Some(cache_read) = read_path_i64(usage, &["cache_read_input_tokens"])
                    .filter(|n| *n > 0)
                {
                    token_usage.cache_read_input_tokens = cache_read;
                }
            }
        }
        "error" => {
            let message = event
                .get("error")
                .and_then(|e| e.get("message"))
                .and_then(Value::as_str)
                .unwrap_or("Anthropic stream failed");
            return Err(Error::from_reason(message.to_string()));
        }
        _ => {}
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

fn build_header_map(api_key: &str, custom_headers: &HashMap<String, String>) -> Result<HeaderMap> {
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert(ACCEPT_ENCODING, HeaderValue::from_static("identity"));
    headers.insert(
        HeaderName::from_static("x-api-key"),
        HeaderValue::from_str(api_key).map_err(|error| {
            Error::from_reason(format!("Invalid API key header value: {}", error))
        })?,
    );
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {}", api_key)).map_err(|error| {
            Error::from_reason(format!("Invalid authorization header value: {}", error))
        })?,
    );

    for (key, value) in custom_headers {
        let trimmed_key = key.trim();
        let trimmed_value = value.trim();
        if trimmed_key.is_empty() || trimmed_value.is_empty() {
            continue;
        }

        if trimmed_key.eq_ignore_ascii_case("content-type")
            || trimmed_key.eq_ignore_ascii_case("accept-encoding")
            || trimmed_key.eq_ignore_ascii_case("authorization")
            || trimmed_key.eq_ignore_ascii_case("x-api-key")
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

fn push_trimmed_string(value: Option<&Value>, chunks: &mut Vec<String>) {
    if let Some(text) = value
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty())
    {
        chunks.push(text.to_string());
    }
}

fn read_string(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(ToString::to_string)
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
