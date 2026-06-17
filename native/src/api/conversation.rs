use std::path::Path;

use napi::bindgen_prelude::*;

use crate::api::chat::create_chat_completion_response_stream;
use crate::api::config::get_active_api_request_context;
use crate::api::responses::{
    create_response_stream_with_context, ResponsesApiRequest,
    ResponsesApiResult, ResponsesApiStreamCallback,
};
use crate::storage::services::chat_conversations::{
    load_context_messages, resolve_conversation_id, ChatContextMessage,
};

pub struct ConversationContextRequest<'a> {
    pub database_path: &'a Path,
    pub conversation_id: Option<&'a str>,
    pub previous_response_id: Option<&'a str>,
    pub messages: &'a [ChatContextMessage],
    pub max_context_tokens: Option<i32>,
}

pub struct PreparedConversationRequest {
    pub conversation_id: String,
    pub messages: Vec<ChatContextMessage>,
    pub current_messages: Vec<ChatContextMessage>,
}

pub fn create_response_stream(
    request: ResponsesApiRequest,
    on_chunk: ResponsesApiStreamCallback<'_>,
) -> Result<ResponsesApiResult> {
    let context = get_active_api_request_context()?;

    match context.api_config.request_method.as_str() {
        "chat" => create_chat_completion_response_stream(
            request,
            context.database_path,
            context.api_config,
            context.custom_headers,
            on_chunk,
        ),
        "responses" => create_response_stream_with_context(
            request,
            context.database_path,
            context.api_config,
            context.custom_headers,
            on_chunk,
        ),
        request_method => Err(Error::from_reason(format!(
            "Unsupported chat request method '{}'. Please switch the active API request method to Chat or Responses.",
            request_method
        ))),
    }
}

pub fn prepare_context_request(
    request: ConversationContextRequest<'_>,
) -> Result<PreparedConversationRequest> {
    let current_messages = normalize_messages(request.messages);
    if current_messages.is_empty() {
        return Err(Error::from_reason("Chat message content is required"));
    }

    let conversation_id = resolve_conversation_id(
        request.database_path,
        request.conversation_id,
        request.previous_response_id,
    )?;
    let mut messages = load_context_messages(request.database_path, &conversation_id)?;

    messages.extend(current_messages.iter().cloned());

    Ok(PreparedConversationRequest {
        conversation_id,
        messages,
        current_messages,
    })
}

fn normalize_messages(messages: &[ChatContextMessage]) -> Vec<ChatContextMessage> {
    messages
        .iter()
        .filter_map(|message| {
            let content = message.content.trim();
            if content.is_empty() {
                return None;
            }

            Some(ChatContextMessage {
                role: normalize_role(&message.role).to_string(),
                content: content.to_string(),
            })
        })
        .collect()
}

fn normalize_role(role: &str) -> &str {
    match role.trim() {
        "assistant" => "assistant",
        "system" => "system",
        "developer" => "developer",
        _ => "user",
    }
}
