use std::path::Path;

use napi::bindgen_prelude::*;

use crate::api::anthropic::create_anthropic_response_stream;
use crate::api::chat::create_chat_completion_response_stream;
use crate::api::config::get_active_api_request_context;
use crate::api::gemini::create_gemini_response_stream;
use crate::api::responses::{
    create_response_stream_with_context, ResponsesApiRequest,
    ResponsesApiResult, ResponsesApiStreamCallback,
};
use crate::prompt::system_prompt::build_system_prompt;
use crate::storage::services::chat_conversations::{
    load_context_messages, resolve_conversation_id, ChatContextMessage,
};
use crate::storage::services::workspace_directories::get_workspace_directory_path;

pub struct ConversationContextRequest<'a> {
    pub database_path: &'a Path,
    pub conversation_id: Option<&'a str>,
    pub previous_response_id: Option<&'a str>,
    pub messages: &'a [ChatContextMessage],
    pub max_context_tokens: Option<i32>,
    pub directory_id: Option<&'a str>,
}

pub struct PreparedConversationRequest {
    pub conversation_id: String,
    pub messages: Vec<ChatContextMessage>,
    pub current_messages: Vec<ChatContextMessage>,
}

pub async fn create_response_stream(
    request: ResponsesApiRequest,
    on_chunk: ResponsesApiStreamCallback,
    stream_id: String,
) -> Result<ResponsesApiResult> {
    let context = get_active_api_request_context()?;
    let cancel_token = crate::api::cancel::create_and_register(&stream_id);

    let result = match context.api_config.request_method.as_str() {
        "chat" => {
            create_chat_completion_response_stream(
                request,
                context.database_path,
                context.api_config,
                context.custom_headers,
                on_chunk,
                cancel_token.clone(),
            )
            .await
        }
        "responses" => {
            create_response_stream_with_context(
                request,
                context.database_path,
                context.api_config,
                context.custom_headers,
                on_chunk,
                cancel_token.clone(),
            )
            .await
        }
        "anthropic" => {
            create_anthropic_response_stream(
                request,
                context.database_path,
                context.api_config,
                context.custom_headers,
                on_chunk,
                cancel_token.clone(),
            )
            .await
        }
        "gemini" => {
            create_gemini_response_stream(
                request,
                context.database_path,
                context.api_config,
                context.custom_headers,
                on_chunk,
                cancel_token.clone(),
            )
            .await
        }
        request_method => Err(Error::from_reason(format!(
            "Unsupported chat request method '{}'. Please switch the active API request method to Chat, Responses, Anthropic or Gemini.",
            request_method
        ))),
    };

    crate::api::cancel::unregister_stream(&stream_id);
    result
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

    // Inject the built-in system prompt as the first message.
    let working_directory = request
        .directory_id
        .and_then(|id| {
            get_workspace_directory_path(request.database_path, id).ok().flatten()
        })
        .unwrap_or_default();

    let system_prompt = build_system_prompt(&working_directory);
    let has_existing_system = messages
        .iter()
        .any(|msg| msg.role.trim() == "system" || msg.role.trim() == "developer");

    if !has_existing_system {
        messages.insert(
            0,
            ChatContextMessage {
                role: "system".to_string(),
                content: system_prompt,
            },
        );
    }

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

            // Preserve original role (including "tool") for database storage.
            // Each API adapter normalizes the role for its own payload.
            Some(ChatContextMessage {
                role: message.role.trim().to_string(),
                content: content.to_string(),
            })
        })
        .collect()
}
