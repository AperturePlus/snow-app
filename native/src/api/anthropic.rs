use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;

use futures::StreamExt;
use napi::bindgen_prelude::*;
use napi::threadsafe_function::ThreadsafeFunctionCallMode;
use reqwest::header::{
    HeaderMap, HeaderName, HeaderValue, ACCEPT_ENCODING, AUTHORIZATION, CONTENT_TYPE,
};
use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::api::config::{
    normalize_base_url, resolve_sdk_api_base_url, DEFAULT_ANTHROPIC_BASE_URL, DEFAULT_OPENAI_BASE_URL,
};
use crate::api::conversation::{
    parse_chat_message_content, prepare_context_request, resolve_sub_agent_tools,
    ConversationContextRequest,
};
use crate::api::responses::{
    ResponsesApiRequest, ResponsesApiResult, ResponsesApiStreamCallback, ResponsesApiStreamChunk,
    TokenUsage,
};
use crate::api::retry::{
    non_sse_response_error, resolve_stream_idle_timeout_sec, should_retry,
    stream_idle_timeout_error, wait_before_retry, RetryOptions,
};
use crate::api::sse::find_sse_separator;
use crate::storage::services::app_logs::{log_api_error, log_api_warning, maybe_log_api_request};
use crate::storage::services::chat_conversations::{
    store_chat_exchange, ChatContextMessage, ChatTokenUsage, StoreChatExchangeInput,
};
use crate::storage::ApiConfigRecord;

const DEFAULT_MAX_TOKENS: i32 = 64000;

/// Process-level persistent Anthropic user_id.
///
/// Mirrors Snow CLI's `getPersistentUserId`: the value is generated once per
/// application session and reused for every request, matching Anthropic's
/// expected `user_<hash>_account__session_<uuid>` format for tracking and
/// prompt-cache routing.
static PERSISTENT_USER_ID: OnceLock<String> = OnceLock::new();

fn get_persistent_user_id() -> &'static str {
    PERSISTENT_USER_ID.get_or_init(|| {
        let session_id = Uuid::new_v4();
        let hash_input = format!("anthropic_user_{session_id}");
        let hash = blake3::hash(hash_input.as_bytes()).to_hex();
        format!("user_{hash}_account__session_{session_id}")
    })
}

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
            tool_calls_json: None,
            tool_results_json: message.tool_results_json.clone(),
            thinking: message.thinking.clone(),
            thinking_blocks_json: message.thinking_blocks_json.clone(),
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
        skip_context: request.skip_context.unwrap_or(false),
        plan_mode: request.plan_mode.unwrap_or(false),
        system_prompt_ids_json: &api_config.system_prompt_ids_json,
    })?;

    let client = crate::api::http_client::build_proxied_client()
        .await
        .map_err(|error| Error::from_reason(format!("Failed to create HTTP client: {}", error)))?;
    let skip_context = request.skip_context.unwrap_or(false);
    let mut prepared_messages = prepared_request.messages;
    crate::api::vision::textify_images_in_messages(
        &mut prepared_messages,
        &database_path,
        &api_config,
        &custom_headers,
        skip_context,
    )
    .await?;

    let tools = if request.context_compaction.unwrap_or(false) || skip_context {
        None
    } else {
        match resolve_sub_agent_tools(&request).await {
            Ok(tools) => Some(crate::mcp::tools::tools_as_anthropic_json(&tools)),
            Err(_) => None,
        }
    };
    let payload = build_anthropic_payload(
        &prepared_messages,
        &database_path,
        &request,
        &api_config,
        tools,
        &prepared_request.user_system_prompts,
    )?;
    let retry_options = RetryOptions::from_config(api_config.max_retries, api_config.retry_base_delay_ms);
    let stream_idle_timeout_sec =
        resolve_stream_idle_timeout_sec(api_config.stream_idle_timeout_sec);

    let request_payload_json = serde_json::to_string(&payload).unwrap_or_default();
    maybe_log_api_request(
        database_path.clone(),
        "anthropic".to_string(),
        endpoint.clone(),
        request_payload_json,
    )
    .await;

    let streamed_response = match collect_anthropic_stream(
        &client,
        &endpoint,
        api_key,
        &custom_headers,
        payload,
        on_chunk,
        &cancel_token,
        &retry_options,
        stream_idle_timeout_sec,
    )
    .await
    {
        Ok(result) => result,
        Err(error) => {
            log_api_error(
                &database_path,
                "create_anthropic_response_stream",
                "Anthropic API call failed",
                &error.reason,
            );
            return Err(error);
        }
    };
    let raw_response_json = serde_json::to_string(&streamed_response.raw_events)
        .unwrap_or_else(|_| "[]".to_string());

    for parse_error in &streamed_response.tool_parse_errors {
        log_api_warning(
            &database_path,
            "create_anthropic_response_stream",
            "Tool call JSON parse failed after streaming",
            parse_error,
        );
    }

    if streamed_response.status != "cancelled"
        && streamed_response.content.is_empty()
        && streamed_response.thinking.is_empty()
        && streamed_response.tool_calls_json == "[]"
    {
        log_api_warning(
            &database_path,
            "create_anthropic_response_stream",
            "AI returned empty response",
            &format!("model={}, status={}", streamed_response.model, streamed_response.status),
        );
    }

    if !skip_context {
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
                response_thinking_blocks_json: &streamed_response.thinking_blocks_json,
                tool_calls_json: &streamed_response.tool_calls_json,
                directory_id: request.directory_id.as_deref().unwrap_or(""),
                context_compaction: request.context_compaction.unwrap_or(false),
                total_duration_ms: streamed_response.total_duration_ms,
            },
        )?;
    }

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
    let has_user_system_prompts = !user_system_prompts.is_empty();
    // When user-configured system prompts exist, they occupy the `system`
    // slot exclusively. The built-in system prompt (already injected as a
    // `system` message by `prepare_context_request`) is demoted to a
    // leading `user` message, matching Snow CLI PR #127.
    let mut builtin_system_parts = Vec::new();
    let mut anthropic_messages = Vec::new();

    for message in messages {
        let content = message.content.trim();
        let role = message.role.trim();

        // --- Tool result messages: emit as user message with tool_result blocks ---
        if role == "tool" {
            if content.is_empty() {
                continue;
            }
            let results = match message.tool_results_json {
                Some(ref raw) => crate::api::conversation::tool_messages::parse_tool_results_json(raw),
                None => Vec::new(),
            };
            let mut tool_result_blocks = Vec::new();
            for (_name, call_id, result) in &results {
                if call_id.is_empty() {
                    tool_result_blocks.push(json!({
                        "type": "text",
                        "text": result,
                    }));
                } else {
                    tool_result_blocks.push(json!({
                        "type": "tool_result",
                        "tool_use_id": call_id,
                        "content": result,
                    }));
                }
            }
            if !tool_result_blocks.is_empty() {
                anthropic_messages.push(json!({
                    "role": "user",
                    "content": tool_result_blocks,
                }));
            }
            continue;
        }

        if content.is_empty() && message.tool_calls_json.is_none() {
            continue;
        }

        // --- Assistant messages with tool_calls ---
        if role == "assistant" {
            // Parse persisted thinking blocks (with signatures) so they can
            // be round-tripped verbatim to the Anthropic API, preserving
            // thinking continuity across turns.
            let thinking_blocks: Vec<Value> = message
                .thinking_blocks_json
                .as_deref()
                .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
                .and_then(|v| v.as_array().map(|a| a.clone()))
                .unwrap_or_default();

            if let Some(ref tool_calls_raw) = message.tool_calls_json {
                let tool_use_blocks =
                    crate::api::conversation::tool_messages::tool_calls_as_anthropic_blocks(tool_calls_raw);
                if !tool_use_blocks.is_empty() {
                    let mut content_blocks = Vec::new();
                    // Thinking blocks must come first so the API can verify
                    // the signature chain before processing text/tool_use.
                    content_blocks.extend(thinking_blocks.iter().cloned());
                    if !content.is_empty() {
                        content_blocks.push(json!({ "type": "text", "text": content }));
                    }
                    content_blocks.extend(tool_use_blocks);
                    anthropic_messages.push(json!({
                        "role": "assistant",
                        "content": content_blocks,
                    }));
                    continue;
                }
            }
            // Fall through: assistant message without tool_calls but with
            // thinking blocks needs an array-format content so the thinking
            // blocks can be included.
            if !thinking_blocks.is_empty() && !content.is_empty() {
                let mut content_blocks: Vec<Value> = thinking_blocks;
                content_blocks.push(json!({ "type": "text", "text": content }));
                anthropic_messages.push(json!({
                    "role": "assistant",
                    "content": content_blocks,
                }));
                continue;
            }
        }

        // --- System/developer messages ---
        if role == "system" || role == "developer" {
            if !content.is_empty() {
                builtin_system_parts.push(content.to_string());
            }
            continue;
        }

        // --- Regular user/assistant messages ---
        if content.is_empty() {
            continue;
        }
        if skip_image_parsing {
            anthropic_messages.push(json!({
                "role": normalize_anthropic_role(role),
                "content": content,
            }));
            continue;
        }

        let parsed_content = parse_chat_message_content(content, database_path)?;
        let content_value = if parsed_content.images.is_empty() {
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
            "content": content_value,
        }));
    }

    // When user system prompts are present, demote the built-in system
    // prompt to a leading `user` message so the `system` field can be
    // exclusively populated with user prompts (Snow CLI PR #127).
    if has_user_system_prompts && !builtin_system_parts.is_empty() {
        let builtin_text = builtin_system_parts.join("\n\n");
        let builtin_block = json!({
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": builtin_text,
                    "cache_control": { "type": "ephemeral", "ttl": "5m" }
                }
            ]
        });
        anthropic_messages.insert(0, builtin_block);
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

    payload["temperature"] = json!(0.7);

    // Build the `system` field.
    // the field exclusively (each prompt as an independent text block, with
    // cache_control on the last block). Otherwise the built-in system
    // prompt parts are used. A plain string system field cannot carry
    // cache_control, so we always emit an array of text blocks.
    let system_parts: Vec<&String> = if has_user_system_prompts {
        user_system_prompts.iter().collect()
    } else {
        builtin_system_parts.iter().collect()
    };

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
    payload["metadata"] = json!({ "user_id": get_persistent_user_id() });

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
    // Skip the leading built-in prompt user message (index 0) when user
    // system prompts are present, since it already carries cache_control.
    if let Some(messages) = payload.get_mut("messages").and_then(Value::as_array_mut) {
        let total = messages.len();
        for index in (0..total).rev() {
            let is_first_user_message = index == 0;
            let is_user_message = messages[index]
                .get("role")
                .and_then(Value::as_str)
                == Some("user");
            if !is_user_message {
                continue;
            }
            // When user system prompts are present, the first user message
            // is the demoted built-in prompt which already has cache_control;
            // skip it so we don't double-tag.
            if has_user_system_prompts && is_first_user_message {
                continue;
            }
            let msg = &mut messages[index];
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
    /// JSON array of complete thinking blocks (each with type/thinking/signature)
    /// captured from the stream. Persisted so the assistant turn can be
    /// round-tripped back to the Anthropic API verbatim on the next request.
    thinking_blocks_json: String,
    model: String,
    status: String,
    token_usage: ChatTokenUsage,
    tool_calls_json: String,
    raw_events: Vec<Value>,
    tool_parse_errors: Vec<String>,
    total_duration_ms: i64,
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
    stream_idle_timeout_sec: u64,
) -> Result<AnthropicStreamResult> {
    let mut attempt: u32 = 0;
    let mut stream_token_count: usize = 0;
    let stream_start = std::time::Instant::now();
    let mut ttft_ms: i64 = 0;

    // State accumulated across the stream of a single HTTP response. These are
    // declared outside the main loop so that, when the stream idle timeout
    // fires mid-stream, we can discard the partial result and reset them before
    // re-issuing the request with the original parameters.
    let mut raw_events: Vec<Value> = Vec::new();
    let mut content_chunks: Vec<String> = Vec::new();
    let mut thinking_chunks: Vec<String> = Vec::new();
    let mut thinking_blocks: Vec<Value> = Vec::new();
    let mut tool_calls: Vec<Value> = Vec::new();
    let mut tool_call_positions_by_index: HashMap<usize, usize> = HashMap::new();
    let mut tool_input_json_by_index: HashMap<usize, String> = HashMap::new();
    let mut tool_parse_errors: Vec<String> = Vec::new();
    let mut response_id = String::new();
    let mut response_model = String::new();
    let mut response_status = String::from("completed");
    let mut token_usage = ChatTokenUsage::default();
    let mut byte_buffer: Vec<u8> = Vec::new();

    let idle_timeout = Duration::from_secs(stream_idle_timeout_sec);
    // Track whether the stream completed normally (via [DONE], finish_reason,
    // or cancellation). When false after the inner loop, the response is
    // marked "incomplete".
    #[allow(unused_assignments)]
    let mut stream_completed_normally = false;
    // Set by process_anthropic_sse_event_block when message_stop is received.
    let mut stream_finished = false;

    loop {
        // ---- Phase 1: send the request (with retry on connect errors) ----
        let response = loop {
            if cancel_token.is_cancelled() {
                return Ok(AnthropicStreamResult {
                    id: String::new(),
                    content: String::new(),
                    thinking: String::new(),
                    thinking_blocks_json: "[]".to_string(),
                    model: String::new(),
                    status: String::from("cancelled"),
                    token_usage: ChatTokenUsage::default(),
                    tool_calls_json: "[]".to_string(),
                    raw_events: Vec::new(),
                    tool_parse_errors: Vec::new(),
                    total_duration_ms: stream_start.elapsed().as_millis() as i64,
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
                        thinking_blocks_json: "[]".to_string(),
                        model: String::new(),
                        status: String::from("cancelled"),
                        token_usage: ChatTokenUsage::default(),
                        tool_calls_json: "[]".to_string(),
                        raw_events: Vec::new(),
                        tool_parse_errors: Vec::new(),
                        total_duration_ms: stream_start.elapsed().as_millis() as i64,
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
                                stream_token_count: stream_token_count as i64,
                                elapsed_ms: stream_start.elapsed().as_millis() as i64,
                                ttft_ms,
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
                            stream_token_count: stream_token_count as i64,
                            elapsed_ms: stream_start.elapsed().as_millis() as i64,
                            ttft_ms,
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

        // ---- Phase 2: read the streaming body (with idle timeout) ----
        let mut stream = response.bytes_stream();
        stream_completed_normally = false;
        // Set to true when the idle-timeout path resets state and breaks the
        // inner loop so the outer loop re-sends the request.
        let mut idle_reset = false;
        // Idle timer: reset on every received chunk. If no data arrives within
        // `stream_idle_timeout_sec`, we abandon the stalled stream and re-issue
        // the request with the original parameters.
        let mut idle_deadline = tokio::time::Instant::now() + idle_timeout;

        loop {
            tokio::select! {
                biased;
                _ = cancel_token.cancelled() => {
                    response_status = String::from("cancelled");
                    stream_completed_normally = true;
                    break;
                }
                _ = tokio::time::sleep_until(idle_deadline) => {
                    // Stream idle timeout: no data received for the configured
                    // period. Treat as a retriable error so the agent loop
                    // re-issues the request with the original parameters.
                    let error = stream_idle_timeout_error();
                    if !should_retry(&error, attempt, retry_options) {
                        // Exhausted retries — return whatever we have so far
                        // rather than discarding partial work. The response
                        // will be marked "incomplete" since [DONE] was never
                        // received.
                        break;
                    }

                    // Emit retry status to frontend so the user sees the
                    // reconnection attempt.
                    on_chunk.call(
                        ResponsesApiStreamChunk {
                            content_delta: String::new(),
                            thinking_delta: String::new(),
                            content: String::new(),
                            thinking: String::new(),
                            retrying: true,
                            retry_attempt: Some((attempt + 1) as i32),
                            retry_error: Some(error.reason.clone()),
                            stream_token_count: stream_token_count as i64,
                            elapsed_ms: stream_start.elapsed().as_millis() as i64,
                            ttft_ms,
                        },
                        ThreadsafeFunctionCallMode::NonBlocking,
                    );

                    match wait_before_retry(retry_options, cancel_token).await {
                        Ok(()) => {
                            // Reset accumulated state so the retry starts fresh.
                            raw_events.clear();
                            content_chunks.clear();
                            thinking_chunks.clear();
                            thinking_blocks.clear();
                            tool_calls.clear();
                            tool_call_positions_by_index.clear();
                            tool_input_json_by_index.clear();
                            tool_parse_errors.clear();
                            byte_buffer.clear();
                            response_id.clear();
                            response_model.clear();
                            response_status = String::from("completed");
                            token_usage = ChatTokenUsage::default();
                            stream_finished = false;
                            attempt += 1;
                            // Jump back to Phase 1 to re-send the request.
                            idle_reset = true;
                            break;
                        }
                        Err(e) => return Err(e),
                    }
                }
                chunk_result = stream.next() => {
                    let Some(chunk_result) = chunk_result else {
                        // Stream ended without message_stop. Treat as incomplete
                        // rather than a hard error so partial content and tool
                        // calls remain usable.
                        break;
                    };

                    let chunk = match chunk_result {
                        Ok(chunk) => chunk,
                        Err(error) => {
                            // Network/read error mid-stream: log and break instead
                            // of returning Err. We keep whatever content and tool
                            // calls have been collected so far so the agent loop
                            // can continue with partial results.
                            eprintln!("Anthropic stream read error (keeping partial result): {error}");
                            break;
                        }
                    };
                    // Any data received — reset the idle timer.
                    idle_deadline = tokio::time::Instant::now() + idle_timeout;
                    byte_buffer.extend_from_slice(&chunk);

                    while let Some((separator_index, separator_len)) =
                        find_sse_separator(&byte_buffer)
                    {
                        let event_block =
                            String::from_utf8_lossy(&byte_buffer[..separator_index]).to_string();
                        byte_buffer = byte_buffer[separator_index + separator_len..].to_vec();
                        let content_start_index = content_chunks.len();
                        let thinking_start_index = thinking_chunks.len();
                        let mut tool_args_delta = String::new();
                        // Process each SSE event block with error tolerance: if a
                        // single data line is malformed, skip it and continue
                        // processing the rest of the stream.
                        process_anthropic_sse_event_block(
                            &event_block,
                            &mut raw_events,
                            &mut content_chunks,
                            &mut thinking_chunks,
                            &mut thinking_blocks,
                            &mut tool_calls,
                            &mut tool_call_positions_by_index,
                            &mut tool_input_json_by_index,
                            &mut response_id,
                            &mut response_model,
                            &mut response_status,
                            &mut token_usage,
                            &mut tool_args_delta,
                            &mut tool_parse_errors,
                            &mut stream_finished,
                        );
                        let content_delta = content_chunks[content_start_index..].join("");
                        let thinking_delta = thinking_chunks[thinking_start_index..].join("");
                        if ttft_ms == 0 {
                            ttft_ms = stream_start.elapsed().as_millis() as i64;
                        }
                        emit_stream_chunk(
                            on_chunk,
                            content_delta,
                            thinking_delta,
                            &mut stream_token_count,
                            stream_start.elapsed().as_millis() as i64,
                            ttft_ms,
                        );
                        // Tool-call argument deltas arrive separately from the
                        // content stream. Emit a probe-only chunk so the
                        // renderer reflects long tool arguments in real time.
                        emit_tool_args_probe(
                            on_chunk,
                            &mut stream_token_count,
                            &tool_args_delta,
                            stream_start.elapsed().as_millis() as i64,
                            ttft_ms,
                        );
                    }
                }
            }
        }

        // If the idle-timeout path reset state, re-send the request.
        // Otherwise the stream is done (completed, cancelled, incomplete, or
        // error) and we proceed to finalize.
        if idle_reset {
            continue;
        }

        // Non-SSE response detection: the stream received bytes but none of
        // them formed a valid SSE event. This happens when a relay returns
        // HTTP 200 with a JSON error body (e.g. quota exhausted) instead of
        // a proper SSE stream. Treat it as a retriable error so the request
        // is re-issued, matching the idle-timeout recovery pattern.
        if !stream_completed_normally
            && response_status != "cancelled"
            && raw_events.is_empty()
            && content_chunks.is_empty()
            && thinking_chunks.is_empty()
            && tool_calls.is_empty()
            && !byte_buffer.is_empty()
        {
            let body = String::from_utf8_lossy(&byte_buffer).to_string();
            let error = non_sse_response_error(&body);

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
                    stream_token_count: stream_token_count as i64,
                    elapsed_ms: stream_start.elapsed().as_millis() as i64,
                    ttft_ms,
                },
                ThreadsafeFunctionCallMode::NonBlocking,
            );

            match wait_before_retry(retry_options, cancel_token).await {
                Ok(()) => {
                    raw_events.clear();
                    content_chunks.clear();
                    thinking_chunks.clear();
                    thinking_blocks.clear();
                    tool_calls.clear();
                    tool_call_positions_by_index.clear();
                    tool_input_json_by_index.clear();
                    tool_parse_errors.clear();
                    byte_buffer.clear();
                    response_id.clear();
                    response_model.clear();
                    response_status = String::from("completed");
                    token_usage = ChatTokenUsage::default();
                    stream_finished = false;
                    attempt += 1;
                    continue;
                }
                Err(e) => return Err(e),
            }
        }

        // Stream finalized — exit the outer loop.
        break;
    }

    // If the stream ended abnormally (no message_stop, no stop_reason, and
    // no cancellation), mark the response as incomplete so the frontend knows
    // the result is partial but still usable.
    if !stream_completed_normally && !stream_finished && response_status == "completed" {
        response_status = String::from("incomplete");
    }

    if response_status != "cancelled" && !byte_buffer.is_empty() {
        let trailing_buffer = String::from_utf8_lossy(&byte_buffer).to_string();
        if !trailing_buffer.trim().is_empty() {
            let content_start_index = content_chunks.len();
            let thinking_start_index = thinking_chunks.len();
            let mut tool_args_delta = String::new();
            process_anthropic_sse_event_block(
                &trailing_buffer,
                &mut raw_events,
                &mut content_chunks,
                &mut thinking_chunks,
                &mut thinking_blocks,
                &mut tool_calls,
                &mut tool_call_positions_by_index,
                &mut tool_input_json_by_index,
                &mut response_id,
                &mut response_model,
                &mut response_status,
                &mut token_usage,
                &mut tool_args_delta,
                &mut tool_parse_errors,
                &mut stream_finished,
            );
            let content_delta = content_chunks[content_start_index..].join("");
            let thinking_delta = thinking_chunks[thinking_start_index..].join("");
            if ttft_ms == 0 {
                ttft_ms = stream_start.elapsed().as_millis() as i64;
            }
            emit_stream_chunk(
                on_chunk,
                content_delta,
                thinking_delta,
                &mut stream_token_count,
                stream_start.elapsed().as_millis() as i64,
                ttft_ms,
            );
            emit_tool_args_probe(
                on_chunk,
                &mut stream_token_count,
                &tool_args_delta,
                stream_start.elapsed().as_millis() as i64,
                ttft_ms,
            );
        }
    }

    let content = content_chunks.join("").trim().to_string();
    let thinking = thinking_chunks.join("").trim().to_string();
    let tool_calls_json = serde_json::to_string(&tool_calls).unwrap_or_else(|_| "[]".to_string());
    let thinking_blocks_json = serde_json::to_string(&thinking_blocks).unwrap_or_else(|_| "[]".to_string());

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
        thinking_blocks_json,
        model: response_model,
        status: response_status,
        token_usage,
        tool_calls_json,
        raw_events,
        tool_parse_errors,
        total_duration_ms: stream_start.elapsed().as_millis() as i64,
    })
}

#[allow(clippy::too_many_arguments)]
fn process_anthropic_sse_event_block(
    event_block: &str,
    raw_events: &mut Vec<Value>,
    content_chunks: &mut Vec<String>,
    thinking_chunks: &mut Vec<String>,
    thinking_blocks: &mut Vec<Value>,
    tool_calls: &mut Vec<Value>,
    tool_call_positions_by_index: &mut HashMap<usize, usize>,
    tool_input_json_by_index: &mut HashMap<usize, String>,
    response_id: &mut String,
    response_model: &mut String,
    response_status: &mut String,
    token_usage: &mut ChatTokenUsage,
    tool_args_delta: &mut String,
    tool_parse_errors: &mut Vec<String>,
    stream_finished: &mut bool,
) {
    // Process each `data:` line independently as a separate SSE event.
    // This matches the TypeScript reference implementation where each line
    // is parsed on its own. Joining multiple data lines into one string
    // (the old behavior) produces invalid JSON when a proxy or server
    // batches multiple events within a single block, causing tool-call
    // deltas to be silently dropped.
    let mut found_data_line = false;
    for line in event_block.lines() {
        let trimmed = line.trim_start();
        let Some(data) = trimmed.strip_prefix("data:") else {
            continue;
        };
        found_data_line = true;
        let data = data.trim_start();

        if data.is_empty() {
            continue;
        }

        let event = match serde_json::from_str::<Value>(data) {
            Ok(event) => event,
            Err(error) => {
                eprintln!(
                    "Anthropic stream event parse error (skipping line): {}",
                    error
                );
                continue;
            }
        };

        // Detect message_stop to signal normal stream completion.
        let event_type = event.get("type").and_then(Value::as_str).unwrap_or_default();
        if event_type == "message_stop" {
            *stream_finished = true;
            raw_events.push(event);
            return;
        }

        if let Err(process_error) = process_anthropic_event(
            &event,
            content_chunks,
            thinking_chunks,
            thinking_blocks,
            tool_calls,
            tool_call_positions_by_index,
            tool_input_json_by_index,
            response_id,
            response_model,
            response_status,
            token_usage,
            tool_args_delta,
            tool_parse_errors,
        ) {
            eprintln!(
                "Anthropic stream event processing error (skipping event): {}",
                process_error.reason
            );
            continue;
        }
        raw_events.push(event);
    }

    // Fallback: some providers return a complete JSON response without SSE
    // `data:` framing. If no `data:` lines were found, try parsing the
    // entire block as raw JSON.
    if !found_data_line {
        let trimmed_block = event_block.trim();
        if trimmed_block.is_empty() || trimmed_block.starts_with(':') {
            return;
        }
        if let Ok(event) = serde_json::from_str::<Value>(trimmed_block) {
            let event_type = event.get("type").and_then(Value::as_str).unwrap_or_default();
            if event_type == "message_stop" {
                *stream_finished = true;
                raw_events.push(event);
                return;
            }
            let _ = process_anthropic_event(
                &event,
                content_chunks,
                thinking_chunks,
                thinking_blocks,
                tool_calls,
                tool_call_positions_by_index,
                tool_input_json_by_index,
                response_id,
                response_model,
                response_status,
                token_usage,
                tool_args_delta,
                tool_parse_errors,
            );
            raw_events.push(event);
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn process_anthropic_event(
    event: &Value,
    content_chunks: &mut Vec<String>,
    thinking_chunks: &mut Vec<String>,
    thinking_blocks: &mut Vec<Value>,
    tool_calls: &mut Vec<Value>,
    tool_call_positions_by_index: &mut HashMap<usize, usize>,
    tool_input_json_by_index: &mut HashMap<usize, String>,
    response_id: &mut String,
    response_model: &mut String,
    response_status: &mut String,
    token_usage: &mut ChatTokenUsage,
    tool_args_delta: &mut String,
    tool_parse_errors: &mut Vec<String>,
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
                } else if block_type == "thinking" || block_type == "redacted_thinking" {
                    // Capture the raw thinking block so it can be round-tripped
                    // back to the API verbatim on the next request (with its
                    // signature intact). thinking_delta and signature_delta
                    // events that follow will mutate the last block in-place.
                    thinking_blocks.push(content_block.clone());
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
                    match serde_json::from_str::<Value>(accumulated.as_str()) {
                        Ok(input) => {
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
                        Err(parse_err) => {
                            let tool_name = tool_call_positions_by_index
                                .get(&index)
                                .and_then(|pos| tool_calls.get(*pos))
                                .and_then(|tc| tc.get("name"))
                                .and_then(Value::as_str)
                                .unwrap_or("unknown");
                            tool_parse_errors.push(format!(
                                "tool={}, index={}, error={}, raw={}",
                                tool_name,
                                index,
                                parse_err,
                                &accumulated[..accumulated.len().min(200)]
                            ));
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
                        // Append the thinking text to the last thinking block
                        // so the block stays complete for round-tripping.
                        if let Some(thinking_block) = thinking_blocks.last_mut() {
                            if let Some(text) = delta.get("thinking").and_then(Value::as_str) {
                                if !text.is_empty() {
                                    if let Some(obj) = thinking_block.as_object_mut() {
                                        let existing = obj
                                            .get("thinking")
                                            .and_then(Value::as_str)
                                            .unwrap_or_default();
                                        obj.insert(
                                            "thinking".to_string(),
                                            Value::String(format!("{existing}{text}")),
                                        );
                                    }
                                }
                            }
                        }
                    }
                    "signature_delta" => {
                        // Write the cryptographic signature into the last
                        // thinking block. Anthropic requires thinking blocks
                        // to carry their original signature when passed back.
                        if let Some(signature) =
                            delta.get("signature").and_then(Value::as_str)
                        {
                            if !signature.is_empty() {
                                if let Some(thinking_block) = thinking_blocks.last_mut() {
                                    if let Some(obj) = thinking_block.as_object_mut() {
                                        obj.insert(
                                            "signature".to_string(),
                                            Value::String(signature.to_string()),
                                        );
                                    }
                                }
                            }
                        }
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
                                // Also accumulate the argument delta for the
                                // token probe so the renderer reflects long
                                // tool arguments in real time.
                                tool_args_delta.push_str(partial_json);

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
    stream_token_count: &mut usize,
    elapsed_ms: i64,
    ttft_ms: i64,
) {
    if content_delta.is_empty() && thinking_delta.is_empty() {
        return;
    }

    let delta_text = if content_delta.is_empty() {
        &thinking_delta
    } else if thinking_delta.is_empty() {
        &content_delta
    } else {
        let combined = format!("{content_delta}{thinking_delta}");
        let count = crate::api::token_counter::count_tokens(&combined);
        *stream_token_count += count;
        on_chunk.call(
            ResponsesApiStreamChunk {
                content_delta,
                thinking_delta,
                content: String::new(),
                thinking: String::new(),
                retrying: false,
                retry_attempt: None,
                retry_error: None,
                stream_token_count: *stream_token_count as i64,
                elapsed_ms,
                ttft_ms,
            },
            ThreadsafeFunctionCallMode::NonBlocking,
        );
        return;
    };

    let count = crate::api::token_counter::count_tokens(delta_text);
    *stream_token_count += count;

    on_chunk.call(
        ResponsesApiStreamChunk {
            content_delta,
            thinking_delta,
            content: String::new(),
            thinking: String::new(),
            retrying: false,
            retry_attempt: None,
            retry_error: None,
            stream_token_count: *stream_token_count as i64,
            elapsed_ms,
            ttft_ms,
        },
        ThreadsafeFunctionCallMode::NonBlocking,
    );
}

/// Emit a probe-only chunk that carries just the updated token count.
///
/// Used for tool-call argument deltas (Anthropic `input_json_delta`),
/// where the argument text is assembled separately via
/// `tool_input_json_by_index` and must NOT be appended to the assistant
/// message body. The probe still needs to update so the renderer
/// reflects long tool arguments in real time.
fn emit_tool_args_probe(
    on_chunk: &ResponsesApiStreamCallback,
    stream_token_count: &mut usize,
    args_delta: &str,
    elapsed_ms: i64,
    ttft_ms: i64,
) {
    if args_delta.is_empty() {
        return;
    }
    let count = crate::api::token_counter::count_tokens(args_delta);
    *stream_token_count += count;
    on_chunk.call(
        ResponsesApiStreamChunk {
            content_delta: String::new(),
            thinking_delta: String::new(),
            content: String::new(),
            thinking: String::new(),
            retrying: false,
            retry_attempt: None,
            retry_error: None,
            stream_token_count: *stream_token_count as i64,
            elapsed_ms,
            ttft_ms,
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

        if trimmed_key.eq_ignore_ascii_case("authorization")
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
