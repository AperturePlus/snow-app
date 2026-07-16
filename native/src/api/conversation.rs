use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use base64::Engine;
use chrono;
use napi::bindgen_prelude::*;

use crate::api::anthropic::create_anthropic_response_stream;
use crate::api::chat::create_chat_completion_response_stream;
use crate::api::config::get_active_api_request_context;
use crate::api::config::get_api_request_context_for_profile;
use crate::api::gemini::create_gemini_response_stream;
use crate::api::responses::{
    create_response_stream_with_context, ResponsesApiRequest,
    ResponsesApiResult, ResponsesApiStreamCallback,
};
use crate::mcp::tools::{collect_all_mcp_tools, collect_allowed_mcp_tools, McpTool};
use crate::prompt::system_prompt::build_system_prompt;
use crate::storage::services::chat_conversations::{
    load_context_messages, resolve_conversation_id, store_failed_chat_exchange,
    ChatContextMessage,
};
use crate::storage::services::workspace_directories::get_workspace_directory_path;

pub struct ConversationContextRequest<'a> {
    pub database_path: &'a Path,
    pub conversation_id: Option<&'a str>,
    pub previous_response_id: Option<&'a str>,
    pub messages: &'a [ChatContextMessage],
    pub max_context_tokens: Option<i32>,
    pub directory_id: Option<&'a str>,
    pub context_compaction: bool,
}

pub struct PreparedConversationRequest {
    pub conversation_id: String,
    pub messages: Vec<ChatContextMessage>,
    pub current_messages: Vec<ChatContextMessage>,
}

#[derive(Clone, Debug)]
pub struct ChatImage {
    pub media_type: String,
    pub data: String,
    pub data_url: String,
}

#[derive(Clone, Debug, Default)]
pub struct ParsedChatMessageContent {
    pub text: String,
    pub images: Vec<ChatImage>,
}

pub async fn create_response_stream(
    request: ResponsesApiRequest,
    on_chunk: ResponsesApiStreamCallback,
    stream_id: String,
) -> Result<ResponsesApiResult> {
    let sub_agent_tools_json = request.sub_agent_tools_json.clone();
    let is_sub_agent = sub_agent_tools_json
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some();

    let context = if is_sub_agent {
        let storage_info = crate::storage::initialize_app_storage()?;
        let database_path = std::path::PathBuf::from(storage_info.database_path);
        let configs = crate::storage::services::api_configs::list_api_configs(&database_path)?;
        let active_profile = configs
            .iter()
            .find(|config| config.is_active)
            .map(|config| config.profile_name.clone());
        get_api_request_context_for_profile(active_profile.as_deref())?
    } else {
        get_active_api_request_context()?
    };
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

pub fn parse_chat_message_content(
    content: &str,
    database_path: &Path,
) -> Result<ParsedChatMessageContent> {
    const IMAGE_TAG_PREFIX: &str = "@@image:";

    let mut parsed = ParsedChatMessageContent::default();
    let mut remaining = content;

    while let Some(tag_start) = remaining.find(IMAGE_TAG_PREFIX) {
        parsed.text.push_str(&remaining[..tag_start]);

        let tag_value_start = tag_start + IMAGE_TAG_PREFIX.len();
        let tag_value_and_rest = &remaining[tag_value_start..];
        let Some(tag_end) = tag_value_and_rest.find("@@") else {
            parsed.text.push_str(&remaining[tag_start..]);
            return Ok(parsed);
        };

        let data_url = &tag_value_and_rest[..tag_end];
        let full_tag_end = tag_value_start + tag_end + 2;
        if let Some(image) = parse_image_tag_value(data_url, database_path)? {
            parsed.images.push(image);
        } else {
            parsed.text.push_str(&remaining[tag_start..full_tag_end]);
        }

        remaining = &remaining[full_tag_end..];
    }

    parsed.text.push_str(remaining);
    parsed.text = parsed.text.trim().to_string();
    Ok(parsed)
}

fn parse_image_tag_value(value: &str, database_path: &Path) -> Result<Option<ChatImage>> {
    let value = value.trim();
    if value.starts_with("data:") {
        return Ok(parse_base64_image_data_url(value));
    }

    let relative_path = value;
    let file_path = database_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(relative_path);

    let bytes = fs::read(&file_path).map_err(|error| {
        Error::from_reason(format!(
            "Failed to read image file '{}': {}",
            file_path.display(),
            error
        ))
    })?;
    if bytes.is_empty() {
        return Ok(None);
    }

    let media_type = extension_to_media_type(&file_path);
    let data = base64::engine::general_purpose::STANDARD.encode(&bytes);
    let data_url = format!("data:{};base64,{}", media_type, data);

    Ok(Some(ChatImage {
        media_type,
        data,
        data_url,
    }))
}

fn parse_base64_image_data_url(data_url: &str) -> Option<ChatImage> {
    let value = data_url.trim();
    let (metadata, data) = value.strip_prefix("data:")?.split_once(',')?;
    let media_type = metadata.strip_suffix(";base64")?.trim();
    let data = data.trim();

    if media_type.len() <= "image/".len() || !media_type.starts_with("image/") || data.is_empty() {
        return None;
    }

    Some(ChatImage {
        media_type: media_type.to_string(),
        data: data.to_string(),
        data_url: value.to_string(),
    })
}

fn persist_inline_images_to_disk(content: &str, database_path: &Path) -> Result<String> {
    const IMAGE_TAG_PREFIX: &str = "@@image:";

    let upload_root = resolve_upload_root(database_path)?;
    let date = chrono::Local::now().format("%Y-%m-%d").to_string();
    let date_dir = upload_root.join(&date);

    let mut result = String::with_capacity(content.len());
    let mut remaining = content;

    while let Some(tag_start) = remaining.find(IMAGE_TAG_PREFIX) {
        result.push_str(&remaining[..tag_start]);

        let tag_value_start = tag_start + IMAGE_TAG_PREFIX.len();
        let tag_value_and_rest = &remaining[tag_value_start..];
        let Some(tag_end) = tag_value_and_rest.find("@@") else {
            result.push_str(&remaining[tag_start..]);
            return Ok(result);
        };

        let data_url = &tag_value_and_rest[..tag_end];
        let full_tag_end = tag_value_start + tag_end + 2;
        if let Some(image_path) = persist_base64_image(data_url, &date_dir)? {
            result.push_str(&format!("@@image:{}@@", image_path));
        } else {
            result.push_str(&remaining[tag_start..full_tag_end]);
        }

        remaining = &remaining[full_tag_end..];
    }

    result.push_str(remaining);
    Ok(result)
}

fn resolve_upload_root(database_path: &Path) -> Result<PathBuf> {
    let parent = database_path.parent().unwrap_or_else(|| Path::new("."));
    Ok(parent.join("upload"))
}

fn persist_base64_image(data_url: &str, date_dir: &Path) -> Result<Option<String>> {
    let value = data_url.trim();
    let (metadata, data) = match value.strip_prefix("data:").and_then(|v| v.split_once(',')) {
        Some(parts) => parts,
        None => return Ok(None),
    };
    let media_type = match metadata.strip_suffix(";base64") {
        Some(media_type) => media_type.trim(),
        None => return Ok(None),
    };
    if media_type.len() <= "image/".len()
        || !media_type.starts_with("image/")
        || data.trim().is_empty()
    {
        return Ok(None);
    }

    let decoded = match base64::engine::general_purpose::STANDARD.decode(data.trim()) {
        Ok(bytes) => bytes,
        Err(_) => return Ok(None),
    };
    if decoded.is_empty() {
        return Ok(None);
    }

    fs::create_dir_all(date_dir).map_err(|error| {
        Error::from_reason(format!(
            "Failed to create upload directory '{}': {}",
            date_dir.display(),
            error
        ))
    })?;

    let hash = blake3::hash(&decoded).to_hex().to_string();
    let ext = media_type_to_extension(media_type);
    let filename = format!("{}.{}", hash, ext);
    let file_path = date_dir.join(&filename);

    if !file_path.exists() {
        let mut file = fs::File::create(&file_path).map_err(|error| {
            Error::from_reason(format!(
                "Failed to create image file '{}': {}",
                file_path.display(),
                error
            ))
        })?;
        file.write_all(&decoded).map_err(|error| {
            Error::from_reason(format!(
                "Failed to write image file '{}': {}",
                file_path.display(),
                error
            ))
        })?;
    }

    let relative = Path::new("upload")
        .join(date_dir.file_name().unwrap_or_default())
        .join(&filename);
    Ok(Some(relative.to_string_lossy().replace('\\', "/")))
}

fn media_type_to_extension(media_type: &str) -> &str {
    match media_type {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/jpg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/bmp" => "bmp",
        "image/svg+xml" => "svg",
        _ => "bin",
    }
}

fn extension_to_media_type(path: &Path) -> String {
    match path.extension().and_then(|ext| ext.to_str()) {
        Some("png") => "image/png".to_string(),
        Some("jpg") | Some("jpeg") => "image/jpeg".to_string(),
        Some("gif") => "image/gif".to_string(),
        Some("webp") => "image/webp".to_string(),
        Some("bmp") => "image/bmp".to_string(),
        Some("svg") => "image/svg+xml".to_string(),
        _ => "application/octet-stream".to_string(),
    }
}

/// Resolve the MCP tool set for a request. When `sub_agent_tools_json` is
/// present and non-empty, the tools are filtered by the configured whitelist
/// via `collect_allowed_mcp_tools`. Otherwise all project-scoped tools are
/// collected via `collect_all_mcp_tools` (the normal main-conversation path).
pub async fn resolve_sub_agent_tools(
    request: &ResponsesApiRequest,
) -> Result<Vec<McpTool>> {
    match request.sub_agent_tools_json.as_deref() {
        Some(tools_json) if !tools_json.trim().is_empty() => {
            collect_allowed_mcp_tools(
                request.directory_id.as_deref(),
                tools_json,
                true,
            )
            .await
        }
        _ => collect_all_mcp_tools(request.directory_id.as_deref()).await,
    }
}
