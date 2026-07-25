use std::path::Path;

use crate::storage::services::chat_conversations::ChatContextMessage;

pub mod context;
pub mod images;
pub mod stream;
pub mod sub_agent;
pub mod tool_messages;

pub use context::{prepare_context_request, PreparedConversationRequest};
pub use images::{parse_chat_message_content, ChatImage, ParsedChatMessageContent};
pub use stream::create_response_stream;
pub use sub_agent::resolve_sub_agent_tools;

pub struct ConversationContextRequest<'a> {
    pub database_path: &'a Path,
    pub conversation_id: Option<&'a str>,
    pub previous_response_id: Option<&'a str>,
    pub messages: &'a [ChatContextMessage],
    pub max_context_tokens: Option<i32>,
    pub directory_id: Option<&'a str>,
    pub context_compaction: bool,
    /// When true, skip loading conversation history and injecting the built-in
    /// system prompt. Used by lightweight single-shot completions such as the
    /// AI commit-message generator.
    pub skip_context: bool,
    /// When true, replace the built-in system prompt with the Plan Mode prompt.
    pub plan_mode: bool,
    /// JSON-encoded list of user system prompt IDs configured for the active
    /// API profile. Empty string means "follow the global active list";
    /// `__DISABLED__` or an empty array opts out. Resolved into prompt
    /// contents and injected as leading `system` messages, mirroring
    /// Snow CLI's `getCustomSystemPromptForConfig`.
    pub system_prompt_ids_json: &'a str,
}
