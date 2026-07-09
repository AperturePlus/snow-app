mod database;
mod paths;
pub mod services;

use std::{fs, path::PathBuf};

use napi::bindgen_prelude::*;
use napi_derive::napi;

#[napi(object)]
pub struct AppStorageInfo {
    pub directory_path: String,
    pub database_path: String,
}

#[napi(object)]
pub struct ApiConfigInput {
    pub profile_name: String,
    pub display_name: String,
    pub is_active: bool,
    pub base_url: String,
    pub base_url_mode: String,
    pub api_key: String,
    pub request_method: String,
    pub advanced_model: String,
    pub basic_model: String,
    pub supports_vision: bool,
    pub vision_base_url: String,
    pub vision_base_url_mode: String,
    pub vision_api_key: String,
    pub vision_request_method: String,
    pub vision_model: String,
    pub max_context_tokens: Option<i32>,
    pub max_tokens: Option<i32>,
    pub stream_idle_timeout_sec: Option<i32>,
    pub enable_auto_compress: bool,
    pub auto_compress_threshold: Option<i32>,
    pub system_prompt_ids_json: String,
    pub custom_header_scheme_id: String,
    pub config_json: String,
    pub source: String,
}

#[napi(object)]
pub struct ApiConfigRecord {
    pub id: String,
    pub profile_name: String,
    pub display_name: String,
    pub is_active: bool,
    pub base_url: String,
    pub base_url_mode: String,
    pub api_key: String,
    pub request_method: String,
    pub advanced_model: String,
    pub basic_model: String,
    pub supports_vision: bool,
    pub vision_base_url: String,
    pub vision_base_url_mode: String,
    pub vision_api_key: String,
    pub vision_request_method: String,
    pub vision_model: String,
    pub max_context_tokens: Option<i32>,
    pub max_tokens: Option<i32>,
    pub stream_idle_timeout_sec: Option<i32>,
    pub enable_auto_compress: bool,
    pub auto_compress_threshold: Option<i32>,
    pub system_prompt_ids_json: String,
    pub custom_header_scheme_id: String,
    pub config_json: String,
    pub source: String,
    pub updated_at: String,
}

#[napi(object)]
pub struct SystemPromptItemInput {
    pub prompt_id: String,
    pub name: String,
    pub content: String,
    pub is_active: bool,
    pub sort_order: i32,
}

#[napi(object)]
pub struct SystemPromptItemRecord {
    pub id: String,
    pub prompt_id: String,
    pub name: String,
    pub content: String,
    pub is_active: bool,
    pub sort_order: i32,
    pub updated_at: String,
}

#[napi(object)]
pub struct CustomHeaderSchemeInput {
    pub scheme_id: String,
    pub name: String,
    pub headers_json: String,
    pub is_active: bool,
    pub sort_order: i32,
}

#[napi(object)]
pub struct CustomHeaderSchemeRecord {
    pub id: String,
    pub scheme_id: String,
    pub name: String,
    pub headers_json: String,
    pub is_active: bool,
    pub sort_order: i32,
    pub updated_at: String,
}

#[napi(object)]
pub struct WorkspaceDirectoryInput {
    pub directory_id: String,
    pub name: String,
    pub path: String,
    pub kind: String,
    pub is_active: bool,
    pub sort_order: i32,
    pub source: String,
}

#[napi(object)]
pub struct WorkspaceDirectoryRecord {
    pub id: String,
    pub directory_id: String,
    pub name: String,
    pub path: String,
    pub kind: String,
    pub is_active: bool,
    pub sort_order: i32,
    pub source: String,
    pub updated_at: String,
}

#[napi(object)]
pub struct McpServerConfigInput {
    pub server_id: String,
    pub scope: String,
    pub name: String,
    pub transport_type: String,
    pub url: String,
    pub command: String,
    pub args_json: String,
    pub env_json: String,
    pub headers_json: String,
    pub enabled: bool,
    pub timeout_ms: Option<i32>,
    pub sort_order: i32,
    pub source: String,
}

#[napi(object)]
pub struct McpServerConfigRecord {
    pub id: String,
    pub server_id: String,
    pub scope: String,
    pub name: String,
    pub transport_type: String,
    pub url: String,
    pub command: String,
    pub args_json: String,
    pub env_json: String,
    pub headers_json: String,
    pub enabled: bool,
    pub timeout_ms: Option<i32>,
    pub sort_order: i32,
    pub source: String,
    pub updated_at: String,
}

#[napi(object)]
pub struct SensitiveCommandConfigInput {
    pub command_id: String,
    pub scope: String,
    pub pattern: String,
    pub description: String,
    pub enabled: bool,
    pub is_preset: bool,
    pub sort_order: i32,
    pub source: String,
}

#[napi(object)]
pub struct SensitiveCommandConfigRecord {
    pub id: String,
    pub command_id: String,
    pub scope: String,
    pub pattern: String,
    pub description: String,
    pub enabled: bool,
    pub is_preset: bool,
    pub sort_order: i32,
    pub source: String,
    pub updated_at: String,
}

#[napi(object)]
pub struct ChatConversationRecord {
    pub conversation_id: String,
    pub title: String,
    pub summary: String,
    pub last_message_preview: String,
    pub message_count: i32,
    pub model: String,
    pub status: String,
    pub directory_id: String,
    pub forked_from_conversation_id: String,
    pub fork_message_count: i32,
    pub created_at: String,
    pub updated_at: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_creation_input_tokens: i64,
    pub cache_read_input_tokens: i64,
}

#[napi(object)]
pub struct ChatConversationPage {
    pub items: Vec<ChatConversationRecord>,
    pub total: i32,
}

#[napi(object)]
pub struct ChatMessageRecord {
    pub id: String,
    pub role: String,
    pub content: String,
    pub thinking: String,
    pub status: String,
    pub model: String,
    pub response_id: String,
    pub tool_calls_json: String,
    pub created_at: String,
}

pub fn initialize_app_storage() -> Result<AppStorageInfo> {
    let storage_dir = ensure_storage_dir()?;
    let database_path = paths::database_file_path(&storage_dir);
    database::ensure_database(&database_path)?;
    services::system_settings::seed_default_settings(&database_path)?;
    services::api_configs::seed_default_api_config(&database_path)?;
    services::sensitive_command_configs::seed_default_sensitive_command_configs(&database_path)?;

    Ok(AppStorageInfo {
        directory_path: storage_dir.to_string_lossy().into_owned(),
        database_path: database_path.to_string_lossy().into_owned(),
    })
}

pub fn get_system_setting_value(setting_code: String) -> Result<Option<String>> {
    let database_path = ensure_database_file()?;
    services::system_settings::get_system_setting_value(&database_path, &setting_code)
}

pub fn set_system_setting(
    setting_name: String,
    setting_code: String,
    setting_value: String,
) -> Result<()> {
    let database_path = ensure_database_file()?;
    services::system_settings::set_system_setting(
        &database_path,
        &setting_name,
        &setting_code,
        &setting_value,
    )
}

pub fn list_api_configs() -> Result<Vec<ApiConfigRecord>> {
    let database_path = ensure_database_file()?;
    services::api_configs::list_api_configs(&database_path)
}

pub fn upsert_api_config(config: ApiConfigInput) -> Result<()> {
    let database_path = ensure_database_file()?;
    services::api_configs::upsert_api_config(&database_path, &config)
}

pub fn delete_api_config(profile_name: String) -> Result<()> {
    let database_path = ensure_database_file()?;
    services::api_configs::delete_api_config(&database_path, &profile_name)
}

pub fn list_system_prompts() -> Result<Vec<SystemPromptItemRecord>> {
    let database_path = ensure_database_file()?;
    services::system_prompts::list_system_prompts(&database_path)
}

pub fn upsert_system_prompt(item: SystemPromptItemInput) -> Result<()> {
    let database_path = ensure_database_file()?;
    services::system_prompts::upsert_system_prompt(&database_path, &item)
}

pub fn delete_system_prompt(prompt_id: String) -> Result<()> {
    let database_path = ensure_database_file()?;
    services::system_prompts::delete_system_prompt(&database_path, &prompt_id)
}

pub fn list_custom_header_schemes() -> Result<Vec<CustomHeaderSchemeRecord>> {
    let database_path = ensure_database_file()?;
    services::custom_header_schemes::list_custom_header_schemes(&database_path)
}

pub fn upsert_custom_header_scheme(item: CustomHeaderSchemeInput) -> Result<()> {
    let database_path = ensure_database_file()?;
    services::custom_header_schemes::upsert_custom_header_scheme(&database_path, &item)
}

pub fn delete_custom_header_scheme(scheme_id: String) -> Result<()> {
    let database_path = ensure_database_file()?;
    services::custom_header_schemes::delete_custom_header_scheme(&database_path, &scheme_id)
}

pub fn list_workspace_directories() -> Result<Vec<WorkspaceDirectoryRecord>> {
    let database_path = ensure_database_file()?;
    services::workspace_directories::list_workspace_directories(&database_path)
}

pub fn upsert_workspace_directory(item: WorkspaceDirectoryInput) -> Result<()> {
    let database_path = ensure_database_file()?;
    services::workspace_directories::upsert_workspace_directory(&database_path, &item)
}

pub fn activate_workspace_directory(directory_id: String) -> Result<()> {
    let database_path = ensure_database_file()?;
    services::workspace_directories::activate_workspace_directory(&database_path, &directory_id)
}

pub fn reorder_workspace_directories(items: Vec<WorkspaceDirectoryInput>) -> Result<()> {
    let database_path = ensure_database_file()?;
    services::workspace_directories::reorder_workspace_directories(&database_path, &items)
}
pub fn delete_workspace_directory(directory_id: String) -> Result<()> {
    let database_path = ensure_database_file()?;
    services::workspace_directories::delete_workspace_directory(&database_path, &directory_id)
}
pub fn read_directory_entries(dir_path: String) -> Result<Vec<services::fs_explorer::DirectoryEntry>> {
    services::fs_explorer::read_directory_entries(&dir_path)
}
pub fn search_files(root_dir: String, query: String) -> Result<Vec<services::fs_explorer::FileSearchResult>> {
    services::fs_explorer::search_files(&root_dir, &query)
}

pub fn read_file_content(file_path: String) -> Result<services::fs_explorer::FileContentResult> {
    services::fs_explorer::read_file_content(&file_path)
}

pub fn list_mcp_server_configs() -> Result<Vec<McpServerConfigRecord>> {
    let database_path = ensure_database_file()?;
    services::mcp_server_configs::list_mcp_server_configs(&database_path)
}

pub fn upsert_mcp_server_config(item: McpServerConfigInput) -> Result<()> {
    let database_path = ensure_database_file()?;
    services::mcp_server_configs::upsert_mcp_server_config(&database_path, &item)
}

pub fn delete_mcp_server_config(server_id: String) -> Result<()> {
    let database_path = ensure_database_file()?;
    services::mcp_server_configs::delete_mcp_server_config(&database_path, &server_id)
}

pub fn list_sensitive_command_configs() -> Result<Vec<SensitiveCommandConfigRecord>> {
    let database_path = ensure_database_file()?;
    services::sensitive_command_configs::list_sensitive_command_configs(&database_path)
}

pub fn upsert_sensitive_command_config(item: SensitiveCommandConfigInput) -> Result<()> {
    let database_path = ensure_database_file()?;
    services::sensitive_command_configs::upsert_sensitive_command_config(&database_path, &item)
}

pub fn delete_sensitive_command_config(command_id: String, scope: String) -> Result<()> {
    let database_path = ensure_database_file()?;
    services::sensitive_command_configs::delete_sensitive_command_config(
        &database_path,
        &command_id,
        &scope,
    )
}

pub fn list_chat_conversations(directory_id: String) -> Result<Vec<ChatConversationRecord>> {
    let database_path = ensure_database_file()?;
    services::chat_conversations::list_chat_conversations(&database_path, &directory_id)
}

pub fn list_chat_conversations_paginated(
    directory_id: String,
    limit: i32,
    offset: i32,
) -> Result<ChatConversationPage> {
    let database_path = ensure_database_file()?;
    services::chat_conversations::list_chat_conversations_paginated(
        &database_path,
        &directory_id,
        limit,
        offset,
    )
}
pub fn list_pinned_conversations(directory_id: String) -> Result<Vec<ChatConversationRecord>> {
    let database_path = ensure_database_file()?;
    services::chat_conversations::list_pinned_conversations(&database_path, &directory_id)
}

pub fn get_chat_conversation(
    conversation_id: String,
) -> Result<Option<ChatConversationRecord>> {
    let database_path = ensure_database_file()?;
    services::chat_conversations::get_chat_conversation(&database_path, &conversation_id)
}

pub fn update_conversation_status(
    conversation_id: String,
    status: String,
) -> Result<()> {
    let database_path = ensure_database_file()?;
    services::chat_conversations::update_conversation_status(
        &database_path,
        &conversation_id,
        &status,
    )
}

pub fn rename_conversation(
    conversation_id: String,
    title: String,
) -> Result<()> {
    let database_path = ensure_database_file()?;
    services::chat_conversations::rename_conversation(
        &database_path,
        &conversation_id,
        &title,
    )
}

pub fn delete_conversation(conversation_id: String) -> Result<()> {
    let database_path = ensure_database_file()?;
    services::chat_conversations::delete_conversation(&database_path, &conversation_id)
}
pub fn list_chat_messages(conversation_id: String) -> Result<Vec<ChatMessageRecord>> {
    let database_path = ensure_database_file()?;
    services::chat_conversations::list_chat_messages(&database_path, &conversation_id)
}
pub fn fork_conversation(
    source_conversation_id: String,
    up_to_response_id: String,
) -> Result<ChatConversationRecord> {
    let database_path = ensure_database_file()?;
    services::chat_conversations::fork_conversation(
        &database_path,
        &source_conversation_id,
        &up_to_response_id,
    )
}

fn ensure_database_file() -> Result<PathBuf> {
    let storage_dir = ensure_storage_dir()?;
    let database_path = paths::database_file_path(&storage_dir);
    database::ensure_database(&database_path)?;
    services::system_settings::seed_default_settings(&database_path)?;
    services::api_configs::seed_default_api_config(&database_path)?;
    services::sensitive_command_configs::seed_default_sensitive_command_configs(&database_path)?;
    Ok(database_path)
}

fn ensure_storage_dir() -> Result<PathBuf> {
    let storage_dir = paths::app_storage_dir()?;
    fs::create_dir_all(&storage_dir).map_err(|error| {
        Error::from_reason(format!(
            "Failed to create Snow App storage directory at '{}': {error}",
            storage_dir.display()
        ))
    })?;

    Ok(storage_dir)
}
