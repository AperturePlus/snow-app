use napi::bindgen_prelude::*;

use crate::api::anthropic::create_anthropic_response_stream;
use crate::api::chat::create_chat_completion_response_stream;
use crate::api::config::{
    get_active_api_request_context, get_api_request_context_for_profile,
};
use crate::api::gemini::create_gemini_response_stream;
use crate::api::responses::{
    create_response_stream_with_context, ResponsesApiRequest, ResponsesApiResult,
    ResponsesApiStreamCallback,
};
use crate::storage::services::chat_conversations::{store_failed_chat_exchange, ChatContextMessage};

pub async fn create_response_stream(
    mut request: ResponsesApiRequest,
    on_chunk: ResponsesApiStreamCallback,
    stream_id: String,
) -> Result<ResponsesApiResult> {
    let is_sub_agent = request
        .sub_agent_tools_json
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some();
    let sub_agent_config_profile = request
        .sub_agent_config_profile
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned);

    let context = tokio::task::spawn_blocking(move || {
        if is_sub_agent {
            get_api_request_context_for_profile(sub_agent_config_profile.as_deref())
        } else {
            get_active_api_request_context()
        }
    })
    .await
    .map_err(|join_error| {
        Error::from_reason(format!(
            "Failed to resolve API configuration: {join_error}"
        ))
    })??;
    if is_sub_agent
        && request
            .model
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .is_none()
    {
        request.model = Some(context.api_config.advanced_model.clone());
    }

    let failure_messages = request
        .messages
        .iter()
        .map(|message| ChatContextMessage {
            role: message.role.clone(),
            content: message.content.clone(),
        })
        .collect::<Vec<_>>();
    let failure_conversation_id = request.conversation_id.clone();
    let failure_previous_response_id = request.previous_response_id.clone();
    let failure_checkpoint_id = request.checkpoint_id.clone().unwrap_or_default();
    let failure_model = request
        .model
        .clone()
        .unwrap_or_else(|| context.api_config.advanced_model.clone());
    let failure_directory_id = request.directory_id.clone().unwrap_or_default();
    let failure_context_compaction = request.context_compaction.unwrap_or(false);
    let failure_database_path = context.database_path.clone();
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
    match result {
        Ok(response) => Ok(response),
        Err(error) => {
            if failure_context_compaction {
                return Err(error);
            }
            let error_message = error.to_string();
            let persisted_error_message = error_message.clone();
            let persisted_failure_model = failure_model.clone();
            let conversation_id = tokio::task::spawn_blocking(move || {
                store_failed_chat_exchange(
                    &failure_database_path,
                    failure_conversation_id.as_deref(),
                    failure_previous_response_id.as_deref(),
                    &failure_messages,
                    &failure_checkpoint_id,
                    &persisted_failure_model,
                    &failure_directory_id,
                    &persisted_error_message,
                )
            })
            .await
            .map_err(|join_error| {
                Error::from_reason(format!(
                    "Failed to persist chat request error: {}",
                    join_error
                ))
            })??;

            Ok(ResponsesApiResult {
                id: String::new(),
                conversation_id,
                content: error_message,
                thinking: String::new(),
                model: failure_model,
                status: "error".to_string(),
                tool_calls_json: "[]".to_string(),
                token_usage: crate::api::responses::TokenUsage {
                    input_tokens: 0,
                    output_tokens: 0,
                    cache_creation_input_tokens: 0,
                    cache_read_input_tokens: 0,
                },
            })
        }
    }
}
