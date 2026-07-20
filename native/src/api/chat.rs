use std::collections::HashMap;
use std::path::{Path, PathBuf};

use futures::StreamExt;
use napi::bindgen_prelude::*;
use napi::threadsafe_function::ThreadsafeFunctionCallMode;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, ACCEPT_ENCODING, AUTHORIZATION, CONTENT_TYPE};
use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;

use crate::api::config::{normalize_base_url, resolve_sdk_api_base_url};
use crate::api::conversation::{
    parse_chat_message_content, prepare_context_request, resolve_sub_agent_tools,
    ConversationContextRequest,
};
use crate::api::responses::{
    ResponsesApiRequest, ResponsesApiResult, ResponsesApiStreamCallback, ResponsesApiStreamChunk,
    TokenUsage,
};

use crate::storage::services::chat_conversations::{
    store_chat_exchange, ChatContextMessage, ChatTokenUsage, StoreChatExchangeInput,
};
use crate::api::retry::{RetryOptions, should_retry, wait_before_retry};
use crate::storage::ApiConfigRecord;
pub async fn create_chat_completion_response_stream(
    request: ResponsesApiRequest,
    database_path: PathBuf,
    api_config: ApiConfigRecord,
    custom_headers: HashMap<String, String>,
    on_chunk: ResponsesApiStreamCallback,
    cancel_token: CancellationToken,
) -> Result<ResponsesApiResult> {
    create_chat_completion_response_async(
        request,
        database_path,
        api_config,
        custom_headers,
        &on_chunk,
        cancel_token,
    )
    .await
}

async fn create_chat_completion_response_async(
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

    let endpoint = resolve_chat_completions_endpoint(&api_config);
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
        skip_context: request.skip_context.unwrap_or(false),
        plan_mode: request.plan_mode.unwrap_or(false),
        system_prompt_ids_json: &api_config.system_prompt_ids_json,
    })?;

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

    let client = reqwest::Client::builder()
        .build()
        .map_err(|error| Error::from_reason(format!("Failed to create HTTP client: {}", error)))?;
    let tools = if request.context_compaction.unwrap_or(false) || skip_context {
        None
    } else {
        match resolve_sub_agent_tools(&request).await {
            Ok(tools) => Some(crate::mcp::tools::tools_as_openai_chat_json(&tools)),
            Err(error) => {
                eprintln!("Failed to prepare MCP tools for OpenAI Chat: {error}");
                None
            }
        }
    };
    let payload = build_chat_completions_payload(
        &prepared_messages,
        &database_path,
        &request,
        &api_config,
        tools,
        &prepared_request.user_system_prompts,
    )?;
    let retry_options = RetryOptions::from_config(api_config.max_retries, api_config.retry_base_delay_ms);
    let streamed_response = collect_chat_completions_stream(
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

fn resolve_chat_completions_endpoint(api_config: &ApiConfigRecord) -> String {
    let normalized_base_url = normalize_base_url(&api_config.base_url);
    if normalized_base_url.is_empty() {
        return normalized_base_url;
    }

    if api_config.base_url_mode == "endpoint" {
        normalized_base_url
    } else {
        format!(
            "{}/chat/completions",
            resolve_sdk_api_base_url(&normalized_base_url, &api_config.base_url_mode)
        )
    }
}

fn build_chat_completions_payload(
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
    let mut payload_messages = Vec::new();

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
                    parts.push(json!({ "type": "text", "text": parsed_content.text }));
                }
                parts.extend(parsed_content.images.iter().map(|image| {
                    json!({
                        "type": "image_url",
                        "image_url": { "url": image.data_url },
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

        payload_messages.push(json!({
            "role": normalize_message_role(role),
            "content": content,
        }));
    }

    // When user system prompts are present, emit them as a single `system`
    // message with multiple content blocks and demote the built-in prompt
    // to a leading `user` message (Snow CLI PR #127).
    if has_user_system_prompts {
        let user_prompt_blocks: Vec<Value> = user_system_prompts
            .iter()
            .map(|text| json!({ "type": "text", "text": text }))
            .collect();
        let system_message = json!({
            "role": "system",
            "content": user_prompt_blocks,
        });
        payload_messages.insert(0, system_message);

        if !builtin_system_parts.is_empty() {
            let builtin_text = builtin_system_parts.join("\n\n");
            let builtin_message = json!({
                "role": "user",
                "content": builtin_text,
            });
            payload_messages.insert(1, builtin_message);
        }
    } else if !builtin_system_parts.is_empty() {
        // No user prompts: keep built-in prompt as a `system` message.
        let builtin_text = builtin_system_parts.join("\n\n");
        let system_message = json!({
            "role": "system",
            "content": builtin_text,
        });
        payload_messages.insert(0, system_message);
    }

    if payload_messages.is_empty() {
        return Err(Error::from_reason("Chat message content is required"));
    }

    let mut payload = json!({
        "model": model,
        "messages": payload_messages,
        "stream": true,
        "stream_options": {
            "include_usage": true,
        },
    });

    if let Some(max_tokens) = api_config.max_tokens {
        if max_tokens > 0 {
            payload["max_tokens"] = json!(max_tokens);
        }
    }

    if let Some(reasoning_effort) = build_chat_reasoning_effort(&api_config.config_json) {
        payload["reasoning_effort"] = json!(reasoning_effort);
    }

    if let Some(tools) = tools {
        if tools.as_array().is_some_and(|items| !items.is_empty()) {
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

fn build_chat_reasoning_effort(config_json: &str) -> Option<String> {
    let parsed = serde_json::from_str::<Value>(config_json).ok()?;
    let chat_thinking = parsed.get("snowcfg")?.get("chatThinking")?.as_object()?;
    let enabled = chat_thinking
        .get("enabled")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    if !enabled {
        return None;
    }

    chat_thinking
        .get("reasoning_effort")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != "none")
        .map(ToString::to_string)
}

struct ChatCompletionStreamResult {
    id: String,
    content: String,
    thinking: String,
    model: String,
    status: String,
    token_usage: ChatTokenUsage,
    tool_calls_json: String,
    raw_events: Vec<Value>,
}

async fn collect_chat_completions_stream(
    client: &reqwest::Client,
    endpoint: &str,
    api_key: &str,
    custom_headers: &HashMap<String, String>,
    payload: Value,
    on_chunk: &ResponsesApiStreamCallback,
    cancel_token: &CancellationToken,
    retry_options: &RetryOptions,
) -> Result<ChatCompletionStreamResult> {
    let mut attempt: u32 = 0;
    let mut stream_token_count: usize = 0;
    let response = loop {
        if cancel_token.is_cancelled() {
            return Ok(ChatCompletionStreamResult {
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
                return Ok(ChatCompletionStreamResult {
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
                result.map_err(|error| Error::from_reason(format!("Failed to create chat stream: {}", error)))
            }
        };

        match result {
            Ok(response) => {
                let status = response.status();
                if !status.is_success() {
                    let error_body = response.text().await.unwrap_or_default();
                    let error = Error::from_reason(format!(
                        "Chat completions request failed: {} {}",
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
    let mut response_id = String::new();
    let mut response_model = String::new();
    let mut response_status = String::from("completed");
    let mut token_usage = ChatTokenUsage::default();
    // Cumulative token counter for the current agent-loop iteration.
    // Every streamed delta (content, thinking, and tool-call arguments)
    // contributes to this counter so the renderer can display a real-time
    // probe that updates on every chunk — including long tool arguments
    // that previously were only counted after the full call assembled.
    let mut buffer = String::new();
    let mut stream = response.bytes_stream();
    // Track whether the stream completed normally. If the loop exits because
    // of a read error or unexpected EOF (not via a finish_reason event and
    // not via cancellation), we mark the response as "incomplete" so the
    // frontend can still process any collected content and tool calls.
    let mut stream_completed_normally = false;
    loop {
        tokio::select! {
            biased;
            _ = cancel_token.cancelled() => {
                response_status = String::from("cancelled");
                stream_completed_normally = true;
                break;
            }
            chunk_result = stream.next() => {
                let Some(chunk_result) = chunk_result else {
                    // Stream ended without a finish_reason. Treat as
                    // incomplete rather than a hard error so partial content
                    // and tool calls remain usable.
                    break;
                };

                let chunk = match chunk_result {
                    Ok(chunk) => chunk,
                    Err(error) => {
                        // Network/read error mid-stream: log and break instead
                        // of returning Err. We keep whatever content and tool
                        // calls have been collected so far so the agent loop
                        // can continue with partial results.
                        eprintln!("Chat stream read error (keeping partial result): {error}");
                        break;
                    }
                };
                buffer.push_str(&String::from_utf8_lossy(&chunk));

                while let Some(separator_index) = buffer.find("\n\n") {
                    let event_block = buffer[..separator_index].to_string();
                    buffer = buffer[separator_index + 2..].to_string();
                    let content_start_index = content_chunks.len();
                    let thinking_start_index = thinking_chunks.len();
                    let mut tool_args_delta = String::new();
                    // Process each SSE event block with error tolerance: if a
                    // single event block is malformed (invalid JSON, unexpected
                    // shape), skip it and continue processing the rest of the
                    // stream rather than aborting the entire response.
                    if let Err(parse_error) = process_sse_event_block(
                        &event_block,
                        &mut raw_events,
                        &mut content_chunks,
                        &mut thinking_chunks,
                        &mut tool_calls,
                        &mut tool_call_positions_by_index,
                        &mut response_id,
                        &mut response_model,
                        &mut response_status,
                        &mut token_usage,
                        &mut tool_args_delta,
                    ) {
                        eprintln!(
                            "Chat stream event parse error (skipping event): {parse_error}"
                        );
                    }
                    let content_delta = content_chunks[content_start_index..].join("");
                    let thinking_delta = thinking_chunks[thinking_start_index..].join("");
                    // Emit content/thinking delta (if any) and update the
                    // token probe for those tokens.
                    emit_chat_completion_stream_chunk(
                        on_chunk,
                        content_delta,
                        thinking_delta,
                        &mut stream_token_count,
                    );
                    // Tool-call argument deltas arrive separately from the
                    // content stream. Emit a probe-only chunk so the
                    // renderer reflects long tool arguments in real time.
                    emit_tool_args_probe(on_chunk, &mut stream_token_count, &tool_args_delta);
                }
            }
        }
    }

    // If the stream ended abnormally (no finish_reason and no cancellation),
    // mark the response as incomplete so the frontend knows the result is
    // partial but still usable.
    if !stream_completed_normally && response_status == "completed" {
        response_status = String::from("incomplete");
    }

    if response_status != "cancelled" && !buffer.trim().is_empty() {
        let content_start_index = content_chunks.len();
        let thinking_start_index = thinking_chunks.len();
        let mut tool_args_delta = String::new();
        if let Err(parse_error) = process_sse_event_block(
            &buffer,
            &mut raw_events,
            &mut content_chunks,
            &mut thinking_chunks,
            &mut tool_calls,
            &mut tool_call_positions_by_index,
            &mut response_id,
            &mut response_model,
            &mut response_status,
            &mut token_usage,
            &mut tool_args_delta,
        ) {
            eprintln!(
                "Chat stream trailing event parse error (skipping event): {parse_error}"
            );
        }
        let content_delta = content_chunks[content_start_index..].join("");
        let thinking_delta = thinking_chunks[thinking_start_index..].join("");
        emit_chat_completion_stream_chunk(
            on_chunk,
            content_delta,
            thinking_delta,
            &mut stream_token_count,
        );
        emit_tool_args_probe(on_chunk, &mut stream_token_count, &tool_args_delta);
    }

    let content = content_chunks.join("").trim().to_string();
    let thinking = thinking_chunks.join("").trim().to_string();
    let tool_calls_json = serde_json::to_string(&tool_calls).unwrap_or_else(|_| "[]".to_string());

    Ok(ChatCompletionStreamResult {
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
fn process_sse_event_block(
    event_block: &str,
    raw_events: &mut Vec<Value>,
    content_chunks: &mut Vec<String>,
    thinking_chunks: &mut Vec<String>,
    tool_calls: &mut Vec<Value>,
    tool_call_positions_by_index: &mut HashMap<usize, usize>,
    response_id: &mut String,
    response_model: &mut String,
    response_status: &mut String,
    token_usage: &mut ChatTokenUsage,
    tool_args_delta: &mut String,
) -> Result<()> {
    let data = event_block
        .lines()
        .filter_map(|line| line.trim_start().strip_prefix("data:"))
        .map(str::trim_start)
        .collect::<Vec<_>>()
        .join("\n");

    if data.trim().is_empty() || data.trim() == "[DONE]" {
        return Ok(());
    }

    let event = serde_json::from_str::<Value>(&data).map_err(|error| {
        Error::from_reason(format!("Failed to parse chat stream event: {}", error))
    })?;
    process_chat_completion_event(
        &event,
        content_chunks,
        thinking_chunks,
        tool_calls,
        tool_call_positions_by_index,
        response_id,
        response_model,
        response_status,
        token_usage,
        tool_args_delta,
    )?;
    raw_events.push(event);

    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn process_chat_completion_event(
    event: &Value,
    content_chunks: &mut Vec<String>,
    thinking_chunks: &mut Vec<String>,
    tool_calls: &mut Vec<Value>,
    tool_call_positions_by_index: &mut HashMap<usize, usize>,
    response_id: &mut String,
    response_model: &mut String,
    response_status: &mut String,
    token_usage: &mut ChatTokenUsage,
    tool_args_delta: &mut String,
) -> Result<()> {
    if let Some(error) = event.get("error") {
        let message = error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("Chat completions stream failed");
        return Err(Error::from_reason(message.to_string()));
    }

    if let Some(id) = read_string(event, "id") {
        *response_id = id;
    }
    if let Some(model) = read_string(event, "model") {
        *response_model = model;
    }
    if let Some(usage) = event.get("usage").filter(|value| !value.is_null()) {
        *token_usage = extract_token_usage(usage);
    }

    if let Some(choices) = event.get("choices").and_then(Value::as_array) {
        for choice in choices {
            if let Some(delta) = choice.get("delta") {
                push_trimmed_string(delta.get("content"), content_chunks);
                push_trimmed_string(delta.get("reasoning_content"), thinking_chunks);
                // Extract tool-call argument deltas so the token probe can
                // reflect long tool arguments in real time. The full
                // arguments are still assembled by `collect_tool_calls`; we
                // only need the delta text for counting.
                collect_tool_call_argument_delta(delta, tool_args_delta);
                collect_tool_calls(delta.get("tool_calls"), tool_calls, tool_call_positions_by_index, true);
            }

            if let Some(message) = choice.get("message") {
                push_trimmed_string(message.get("content"), content_chunks);
                push_trimmed_string(message.get("reasoning_content"), thinking_chunks);
                collect_tool_calls(message.get("tool_calls"), tool_calls, tool_call_positions_by_index, false);
            }

            if let Some(finish_reason) = choice
                .get("finish_reason")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
            {
                *response_status = if finish_reason == "stop" {
                    "completed".to_string()
                } else {
                    finish_reason.to_string()
                };
            }
        }
    }

    Ok(())
}

/// Extract the concatenated argument deltas from a Chat Completions
/// `delta.tool_calls` array. The delta object looks like:
///
/// ```json
/// { "tool_calls": [{ "index": 0, "function": { "arguments": "..." } }] }
/// ```
///
/// Only the `arguments` string fragments are appended to `out` because
/// those are the streaming pieces that grow over time. Name/id fields
/// appear once at the start and are not useful for the token probe.
fn collect_tool_call_argument_delta(delta: &Value, out: &mut String) {
    let Some(tool_calls) = delta.get("tool_calls").and_then(Value::as_array) else {
        return;
    };
    for tool_call in tool_calls {
        if let Some(args) = tool_call
            .get("function")
            .and_then(|function| function.get("arguments"))
            .and_then(Value::as_str)
        {
            if !args.is_empty() {
                out.push_str(args);
            }
        }
    }
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
fn emit_chat_completion_stream_chunk(
    on_chunk: &ResponsesApiStreamCallback,
    content_delta: String,
    thinking_delta: String,
    stream_token_count: &mut usize,
) {
    if content_delta.is_empty() && thinking_delta.is_empty() {
        return;
    }

    // Count tokens for the delta text only.
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
        },
        ThreadsafeFunctionCallMode::NonBlocking,
    );
}

/// Emit a probe-only chunk that carries just the updated token count.
///
/// Used for tool-call argument deltas in Chat Completions, where the
/// argument text is assembled separately via `collect_tool_calls` and
/// must NOT be appended to the assistant message body. The probe still
/// needs to update so the renderer reflects long tool arguments in real
/// time.
fn emit_tool_args_probe(
    on_chunk: &ResponsesApiStreamCallback,
    stream_token_count: &mut usize,
    args_delta: &str,
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
        },
        ThreadsafeFunctionCallMode::NonBlocking,
    );
}

fn build_header_map(api_key: &str, custom_headers: &HashMap<String, String>) -> Result<HeaderMap> {
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert(ACCEPT_ENCODING, HeaderValue::from_static("identity"));
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
        {
            continue;
        }

        let header_name = trimmed_key.parse::<HeaderName>().map_err(|error| {
            Error::from_reason(format!("Invalid custom header '{}': {}", trimmed_key, error))
        })?;
        let header_value = HeaderValue::from_str(trimmed_value).map_err(|error| {
            Error::from_reason(format!("Invalid custom header value for '{}': {}", trimmed_key, error))
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

fn extract_token_usage(usage: &Value) -> ChatTokenUsage {
    ChatTokenUsage {
        input_tokens: read_first_i64(usage, &[&["prompt_tokens"], &["input_tokens"]]),
        output_tokens: read_first_i64(usage, &[&["completion_tokens"], &["output_tokens"]]),
        cache_creation_input_tokens: read_first_i64(
            usage,
            &[
                &["prompt_cache_creation_tokens"],
                &["cache_creation_input_tokens"],
                &["prompt_tokens_details", "cache_creation_input_tokens"],
                &["prompt_tokens_details", "cache_creation_tokens"],
            ],
        ),
        cache_read_input_tokens: read_first_i64(
            usage,
            &[
                &["cached_tokens"],
                &["prompt_cache_hit_tokens"],
                &["cache_read_input_tokens"],
                &["cache_hit_input_tokens"],
                &["cache_hit_tokens"],
                &["prompt_tokens_details", "cache_read_input_tokens"],
                &["prompt_tokens_details", "cache_hit_tokens"],
                &["prompt_tokens_details", "cached_tokens"],
            ],
        ),
    }
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

    current
        .as_i64()
        .or_else(|| current.as_u64().and_then(|number| i64::try_from(number).ok()))
        .or_else(|| current.as_f64().map(|number| number as i64))
}

fn collect_tool_calls(
    value: Option<&Value>,
    calls: &mut Vec<Value>,
    positions_by_index: &mut HashMap<usize, usize>,
    merge_by_index: bool,
) {
    let Some(value) = value else {
        return;
    };

    match value {
        Value::Array(items) => {
            for item in items {
                collect_tool_calls(Some(item), calls, positions_by_index, merge_by_index);
            }
        }
        Value::Object(object) => {
            if merge_by_index {
                if let Some(index) = object
                    .get("index")
                    .and_then(Value::as_u64)
                    .and_then(|value| usize::try_from(value).ok())
                {
                    if let Some(position) = positions_by_index.get(&index).copied() {
                        if let Some(target) = calls.get_mut(position) {
                            merge_tool_call_value(target, value);
                            return;
                        }
                    }
                    positions_by_index.insert(index, calls.len());
                }
            }

            calls.push(value.clone());
        }
        _ => {}
    }
}

fn merge_tool_call_value(target: &mut Value, delta: &Value) {
    match (target, delta) {
        (Value::Object(target_object), Value::Object(delta_object)) => {
            for (key, delta_value) in delta_object {
                if is_ignorable_tool_call_delta_value(delta_value) {
                    continue;
                }

                if let Some(target_value) = target_object.get_mut(key) {
                    merge_tool_call_field(key, target_value, delta_value);
                } else {
                    target_object.insert(key.clone(), delta_value.clone());
                }
            }
        }
        (target_value, delta_value) => {
            if !is_ignorable_tool_call_delta_value(delta_value) {
                *target_value = delta_value.clone();
            }
        }
    }
}

fn merge_tool_call_field(key: &str, target: &mut Value, delta: &Value) {
    if key == "arguments" {
        if let (Value::String(target_text), Value::String(delta_text)) = (&mut *target, delta) {
            target_text.push_str(delta_text);
            return;
        }
    }

    merge_tool_call_value(target, delta);
}

fn is_ignorable_tool_call_delta_value(value: &Value) -> bool {
    value.is_null() || value.as_str().is_some_and(str::is_empty)
}

fn read_string(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(ToString::to_string)
}
