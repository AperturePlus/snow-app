use std::collections::HashMap;
use std::path::{Path, PathBuf};
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
use crate::api::conversation::{
    parse_chat_message_content, prepare_context_request, resolve_sub_agent_tools,
    ConversationContextRequest,
};
use crate::api::retry::{RetryOptions, should_retry, wait_before_retry};
use crate::storage::services::app_logs::{log_api_error, log_api_warning};
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
    pub context_compaction: Option<bool>,
    pub sub_agent_tools_json: Option<String>,
    pub sub_agent_config_profile: Option<String>,
    /// When true, skip loading conversation history and injecting the built-in
    /// system prompt. Used by lightweight single-shot completions (e.g. AI
    /// commit-message generation).
    pub skip_context: Option<bool>,
    /// When true, replace the built-in system prompt with the Plan Mode prompt
    /// that instructs the AI to plan and get user approval before executing.
    pub plan_mode: Option<bool>,
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
    pub retrying: bool,
    pub retry_attempt: Option<i32>,
    pub retry_error: Option<String>,
    /// Cumulative token count for the current agent-loop iteration.
    ///
    /// The Rust backend counts tokens for every streamed delta (content and
    /// thinking) using the `o200k_base` tokenizer and accumulates them across
    /// chunks within a single `collect_streaming_response` call. The renderer
    /// treats this as a real-time probe: it resets to zero when a new
    /// iteration starts and ignores it for non-streaming chunks (retry
    /// events), where the field stays at the previously-accumulated value.
    pub stream_token_count: i64,
    /// Elapsed milliseconds since the streaming request started. Updated
    /// on every chunk so the renderer can display a live timer.
    pub elapsed_ms: i64,
    /// Time to first token in milliseconds. Zero until the first content
    /// or thinking delta arrives, then frozen at that value for the
    /// remainder of the streaming iteration.
    pub ttft_ms: i64,
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
        context_compaction: request.context_compaction.unwrap_or(false),
        skip_context: request.skip_context.unwrap_or(false),
        plan_mode: request.plan_mode.unwrap_or(false),
        system_prompt_ids_json: &api_config.system_prompt_ids_json,
    })?;

    // Inject conversation_id and session_id as request headers for prompt
    // caching.  OpenAI's Responses API uses these headers (along with
    // prompt_cache_key in the payload) to route requests to the same cache
    // shard.  Matches snow-cli's header injection behavior.
    let mut effective_headers = custom_headers;
    if let Some(ref conv_id) = request.conversation_id {
        if !conv_id.is_empty() {
            effective_headers.insert("conversation_id".to_string(), conv_id.clone());
            effective_headers.insert("session_id".to_string(), conv_id.clone());
        }
    }

    let client = build_openai_client(&base_url, api_key, &effective_headers)?;
    let skip_context = request.skip_context.unwrap_or(false);
    let mut prepared_messages = prepared_request.messages;
    crate::api::vision::textify_images_in_messages(
        &mut prepared_messages,
        &database_path,
        &api_config,
        &effective_headers,
        skip_context,
    )
    .await?;

    let tools = if request.context_compaction.unwrap_or(false) || skip_context {
        None
    } else {
        match resolve_sub_agent_tools(&request).await {
            Ok(tools) => Some(crate::mcp::tools::tools_as_openai_responses_json(&tools)),
            Err(error) => {
                eprintln!("Failed to prepare MCP tools for OpenAI Responses: {error}");
                None
            }
        }
    };
    let payload = build_responses_payload(
        &prepared_messages,
        &database_path,
        &request,
        &api_config,
        tools,
        &prepared_request.user_system_prompts,
    )?;
    let retry_options = RetryOptions::from_config(api_config.max_retries, api_config.retry_base_delay_ms);
    let streamed_response = match collect_streaming_response(&client, payload, on_chunk, &cancel_token, &retry_options).await {
        Ok(result) => result,
        Err(error) => {
            log_api_error(
                &database_path,
                "create_response_stream_with_context",
                "Responses API call failed",
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
            "create_response_stream_with_context",
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
            "create_response_stream_with_context",
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
    let mut builtin_system_parts = Vec::new();
    let mut input = Vec::new();

    for message in messages {
        let content = message.content.trim();
        if content.is_empty() {
            continue;
        }

        let content = if skip_image_parsing {
            Value::String(content.to_string())
        } else {
            let parsed_content = parse_chat_message_content(content, database_path)?;
            if parsed_content.images.is_empty() {
                Value::String(parsed_content.text)
            } else {
                let mut parts = Vec::new();
                if !parsed_content.text.is_empty() {
                    parts.push(json!({ "type": "input_text", "text": parsed_content.text }));
                }
                parts.extend(parsed_content.images.iter().map(|image| {
                    json!({
                        "type": "input_image",
                        "image_url": image.data_url,
                    })
                }));
                Value::Array(parts)
            }
        };

        let role = message.role.trim();
        if role == "system" || role == "developer" {
            // Collect built-in system prompt parts; they will be emitted
            // either as a `system` message (no user prompts) or demoted to
            // a leading `user` message (user prompts present), matching
            // Snow CLI PR #127.
            if let Value::String(text) = &content {
                if !text.is_empty() {
                    builtin_system_parts.push(text.clone());
                }
            }
            continue;
        }

        input.push(json!({
            "type": "message",
            "role": normalize_message_role(role),
            "content": content,
        }));
    }

    // When user system prompts are present, emit them as a `system` message
    // with multiple content blocks and demote the built-in prompt to a
    // leading `user` message (Snow CLI PR #127).
    if has_user_system_prompts {
        let user_prompt_blocks: Vec<Value> = user_system_prompts
            .iter()
            .map(|text| json!({ "type": "input_text", "text": text }))
            .collect();
        let system_message = json!({
            "type": "message",
            "role": "system",
            "content": user_prompt_blocks,
        });
        input.insert(0, system_message);

        if !builtin_system_parts.is_empty() {
            let builtin_text = builtin_system_parts.join("\n\n");
            let builtin_message = json!({
                "type": "message",
                "role": "user",
                "content": builtin_text,
            });
            input.insert(1, builtin_message);
        }
    } else if !builtin_system_parts.is_empty() {
        // No user prompts: keep built-in prompt as a `system` message.
        let builtin_text = builtin_system_parts.join("\n\n");
        let system_message = json!({
            "type": "message",
            "role": "system",
            "content": builtin_text,
        });
        input.insert(0, system_message);
    }

    if input.is_empty() {
        return Err(Error::from_reason("Chat message content is required"));
    }

    let mut payload = json!({
        "model": model,
        "input": input,
        "stream": true,
        "store": false,
    });

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
    tool_parse_errors: Vec<String>,
    total_duration_ms: i64,
}

async fn collect_streaming_response(
    client: &Client<OpenAIConfig>,
    payload: Value,
    on_chunk: &ResponsesApiStreamCallback,
    cancel_token: &CancellationToken,
    retry_options: &RetryOptions,
) -> Result<StreamingResponseResult> {
    let responses = client.responses();
    let mut attempt: u32 = 0;
    // Cumulative token counter for the current agent-loop iteration.
    // Declared here (before the retry loop) so retry chunks can report
    // the current cumulative value. The counter is mutated by
    // `emit_stream_chunk` and the tool-argument probe below.
    let mut stream_token_count: usize = 0;
    let stream_start = std::time::Instant::now();
    let mut ttft_ms: i64 = 0;
    let mut stream: ResponseValueStream = loop {
        if cancel_token.is_cancelled() {
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
                tool_parse_errors: Vec::new(),
                total_duration_ms: stream_start.elapsed().as_millis() as i64,
            });
        }

        let create_stream_future = responses.create_stream_byot::<Value, Value>(payload.clone());

        let result = tokio::select! {
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
                    tool_parse_errors: Vec::new(),
                    total_duration_ms: stream_start.elapsed().as_millis() as i64,
                });
            }
            result = create_stream_future => {
                result.map_err(|error| Error::from_reason(format!("Failed to create response stream: {}", error)))
            }
        };

        match result {
            Ok(stream) => break stream,
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

    let mut raw_events = Vec::new();
    let mut content_chunks = Vec::new();
    let mut thinking_chunks = Vec::new();
    let mut tool_calls = Vec::new();
    let mut tool_parse_errors: Vec<String> = Vec::new();
    // Streaming tool-call accumulator: maps output_item index -> (item_json, accumulated_arguments).
    // When the stream ends abruptly (network error, server disconnect) before
    // `response.output_item.done` fires, we rebuild tool calls from these
    // partial entries so the agent loop can still execute the requested tools
    // instead of silently dropping them.
    let mut streaming_tool_items: std::collections::HashMap<u64, (Value, String)> =
        std::collections::HashMap::new();
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
    // Track whether the stream completed normally. If the loop exits because
    // of a read error or unexpected EOF (not via response.completed/incomplete/
    // failed event, and not via cancellation), we mark the response as
    // "incomplete" so the frontend can still process any collected content
    // and tool calls instead of treating it as a hard failure.
    let mut stream_completed_normally = false;

    loop {
        tokio::select! {
            biased;
            _ = cancel_token.cancelled() => {
                response_status = String::from("cancelled");
                stream_completed_normally = true;
                break;
            }
            event_result = stream.next() => {
                let Some(event_result) = event_result else {
                    // Stream ended without an explicit terminal event. Treat
                    // this as an incomplete response rather than a hard error
                    // so partial content and tool calls remain usable.
                    break;
                };

                let event = match event_result {
                    Ok(event) => event,
                    Err(error) if is_stream_ended_error(&error) => break,
                    Err(error) => {
                        // Network/read error mid-stream: log and break instead
                        // of returning Err. We keep whatever content and tool
                        // calls have been collected so far so the agent loop
                        // can continue with partial results.
                        eprintln!("Responses stream read error (keeping partial result): {error}");
                        break;
                    }
                };
                let event_type = event.get("type").and_then(Value::as_str).unwrap_or_default();

                match event_type {
                    "response.output_text.delta" => {
                        let content_delta = read_stream_text_delta(event.get("delta"));
                        if !content_delta.is_empty() {
                            content_chunks.push(content_delta.clone());
                            if ttft_ms == 0 {
                                ttft_ms = stream_start.elapsed().as_millis() as i64;
                            }
                            emit_stream_chunk(
                                on_chunk,
                                content_delta,
                                String::new(),
                                &mut stream_token_count,
                                stream_start.elapsed().as_millis() as i64,
                                ttft_ms,
                            );
                        }
                    }
                    "response.reasoning_summary_text.delta" => {
                        let thinking_delta = read_stream_text_delta(event.get("delta"));
                        if !thinking_delta.is_empty() {
                            thinking_chunks.push(thinking_delta.clone());
                            if ttft_ms == 0 {
                                ttft_ms = stream_start.elapsed().as_millis() as i64;
                            }
                            emit_stream_chunk(
                                on_chunk,
                                String::new(),
                                thinking_delta,
                                &mut stream_token_count,
                                stream_start.elapsed().as_millis() as i64,
                                ttft_ms,
                            );
                        }
                    }
                    "response.reasoning_summary.delta" => {
                        if let Some(delta) = event.get("delta") {
                            let mut delta_chunks = Vec::new();
                            collect_text_values(delta, &mut delta_chunks);
                            let thinking_delta = delta_chunks.join("");
                            if !thinking_delta.is_empty() {
                                thinking_chunks.push(thinking_delta.clone());
                                if ttft_ms == 0 {
                                    ttft_ms = stream_start.elapsed().as_millis() as i64;
                                }
                                emit_stream_chunk(
                                    on_chunk,
                                    String::new(),
                                    thinking_delta,
                                    &mut stream_token_count,
                                    stream_start.elapsed().as_millis() as i64,
                                    ttft_ms,
                                );
                            }
                        }
                    }
                    // Tool-call argument deltas. The Responses API streams
                    // function arguments as they are generated. We count
                    // these tokens immediately so the probe reflects long
                    // tool arguments in real time, rather than waiting for
                    // `response.output_item.done` to assemble the full call.
                    //
                    // The chunk is emitted as a probe-only update: both
                    // content_delta and thinking_delta are empty because the
                    // argument text should NOT be appended to the assistant
                    // message body — it is assembled separately by
                    // `collect_tool_calls` on `output_item.done`.
                    //
                    // We also accumulate the argument fragments per output
                    // item index so that, if the stream is interrupted before
                    // `output_item.done`, we can still reconstruct the tool
                    // call with its (possibly partial) arguments.
                    "response.function_call_arguments.delta" => {
                        let args_delta = read_stream_text_delta(event.get("delta"));
                        if !args_delta.is_empty() {
                            let delta_tokens =
                                crate::api::token_counter::count_tokens(&args_delta);
                            stream_token_count += delta_tokens;
                            if ttft_ms == 0 {
                                ttft_ms = stream_start.elapsed().as_millis() as i64;
                            }
                            on_chunk.call(
                                ResponsesApiStreamChunk {
                                    content_delta: String::new(),
                                    thinking_delta: String::new(),
                                    content: String::new(),
                                    thinking: String::new(),
                                    retrying: false,
                                    retry_attempt: None,
                                    retry_error: None,
                                    stream_token_count: stream_token_count as i64,
                                    elapsed_ms: stream_start.elapsed().as_millis() as i64,
                                    ttft_ms,
                                },
                                ThreadsafeFunctionCallMode::NonBlocking,
                            );

                            // Accumulate argument fragments for partial-recovery.
                            if let Some(index) = event
                                .get("output_index")
                                .and_then(Value::as_u64)
                                .or_else(|| event.get("index").and_then(Value::as_u64))
                            {
                                streaming_tool_items
                                    .entry(index)
                                    .and_modify(|(_, args)| args.push_str(&args_delta))
                                    .or_insert_with(|| (Value::Null, args_delta));
                            }
                        }
                    }
                    // Track newly added function_call output items so we can
                    // reconstruct them (name + call_id) if the stream ends
                    // before `output_item.done`.
                    "response.output_item.added" => {
                        if let Some(item) = event.get("item") {
                            let item_type = item
                                .get("type")
                                .and_then(Value::as_str)
                                .unwrap_or_default();
                            if matches!(
                                item_type,
                                "function_call" | "tool_call" | "custom_tool_call" | "mcp_call"
                            ) {
                                if let Some(index) = event
                                    .get("output_index")
                                    .and_then(Value::as_u64)
                                    .or_else(|| event.get("index").and_then(Value::as_u64))
                                {
                                    streaming_tool_items
                                        .entry(index)
                                        .and_modify(|(stored, _)| *stored = item.clone())
                                        .or_insert_with(|| (item.clone(), String::new()));
                                }
                            }
                        }
                    }
                    "response.output_item.done" => {
                        collect_tool_calls(event.get("item"), &mut tool_calls);
                        // Remove from the streaming map once finalized.
                        if let Some(index) = event
                            .get("output_index")
                            .and_then(Value::as_u64)
                            .or_else(|| event.get("index").and_then(Value::as_u64))
                        {
                            streaming_tool_items.remove(&index);
                        }
                    }
                    "response.completed" | "response.incomplete" | "response.failed" => {
                        stream_completed_normally = true;
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

    // If the stream ended abnormally (no terminal event and no cancellation),
    // mark the response as incomplete so the frontend knows the result is
    // partial but still usable.
    if !stream_completed_normally && response_status == "completed" {
        response_status = String::from("incomplete");
    }

    // Reconstruct tool calls from streaming fragments when the normal
    // `output_item.done` path did not fire for every item. This handles the
    // case where the stream was interrupted mid-tool-call: we take the item
    // metadata (name, call_id) captured in `output_item.added` and attach the
    // accumulated argument fragments. Even if the arguments are partial JSON,
    // we pass them through as a string so the frontend/tool layer can decide
    // how to handle them.
    if tool_calls.is_empty() && !streaming_tool_items.is_empty() {
        let mut indices: Vec<u64> = streaming_tool_items.keys().copied().collect();
        indices.sort_unstable();
        for index in indices {
            let (item, args) = streaming_tool_items.remove(&index).unwrap();
            if item.is_null() {
                // We have arguments but no item metadata — cannot reconstruct
                // a meaningful tool call without name/call_id. Skip it.
                continue;
            }
            let mut reconstructed = item;
            if !args.is_empty() {
                // Try to parse the accumulated arguments as JSON; if that
                // fails, embed the raw string so the tool layer can surface a
                // clear error rather than silently dropping the call.
                if let Ok(parsed) = serde_json::from_str::<Value>(&args) {
                    reconstructed
                        .as_object_mut()
                        .map(|obj| obj.insert("arguments".to_string(), parsed));
                } else {
                    tool_parse_errors.push(format!(
                        "tool=reconstructed, error=invalid JSON, raw={}",
                        &args[..args.len().min(200)]
                    ));
                    reconstructed
                        .as_object_mut()
                        .map(|obj| obj.insert("arguments".to_string(), Value::String(args)));
                }
            }
            tool_calls.push(reconstructed);
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
        tool_parse_errors,
        total_duration_ms: stream_start.elapsed().as_millis() as i64,
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
///
/// `stream_token_count` is the cumulative token counter for the current
/// agent-loop iteration. The counter is mutated in place: each call adds the
/// token count of the delta text (content + thinking) so the renderer always
/// receives the up-to-date probe value.
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

    // Count tokens for the delta text only. Using `encode_ordinary` avoids
    // treating substrings as special tokens, matching the JS `tiktoken`
    // `encode_ordinary` behavior used by Snow CLI.
    let delta_text = if content_delta.is_empty() {
        &thinking_delta
    } else if thinking_delta.is_empty() {
        &content_delta
    } else {
        // Combine both deltas for a single encode pass. This branch is rare
        // (current callers always pass one empty string), but we handle it
        // for correctness.
        // We need an owned String to avoid lifetime issues.
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
