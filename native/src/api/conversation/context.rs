use napi::bindgen_prelude::*;

use crate::prompt::system_prompt::build_system_prompt;
use crate::storage::services::chat_conversations::{
    load_context_messages, resolve_conversation_id, ChatContextMessage,
};
use crate::storage::services::workspace_directories::get_workspace_directory_path;

use super::{images::persist_inline_images_to_disk, ConversationContextRequest};

pub struct PreparedConversationRequest {
    pub conversation_id: String,
    pub messages: Vec<ChatContextMessage>,
    pub current_messages: Vec<ChatContextMessage>,
}

pub fn prepare_context_request(
    request: ConversationContextRequest<'_>,
) -> Result<PreparedConversationRequest> {
    let mut current_messages = if request.context_compaction {
        vec![ChatContextMessage {
            // Use a final user instruction for cross-provider compatibility. Some
            // OpenAI-compatible Chat endpoints reject the `developer` role.
            role: "user".to_string(),
            content: "Create a durable context handoff for the next assistant. Output only the handoff document in Markdown. Preserve concrete objectives, user requirements, decisions, architecture constraints, relevant files and symbols, completed changes, current state, pending tasks, exact commands or errors, edge cases, and the next recommended steps. Be concise but do not omit information required to continue the work correctly. Do not call tools and do not address the user conversationally.".to_string(),
        }]
    } else {
        normalize_messages(request.messages)
    };
    for message in &mut current_messages {
        message.content = persist_inline_images_to_disk(&message.content, request.database_path)?;
    }
    if current_messages.is_empty() {
        return Err(Error::from_reason("Chat message content is required"));
    }

    // --- Lightweight mode: skip history loading and system-prompt injection ---
    if request.skip_context {
        return Ok(PreparedConversationRequest {
            conversation_id: String::new(),
            messages: current_messages.clone(),
            current_messages,
        });
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
