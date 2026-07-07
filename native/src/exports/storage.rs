use napi::bindgen_prelude::*;
use napi_derive::napi;

use crate::storage::{
    ApiConfigInput, ApiConfigRecord, AppStorageInfo, ChatConversationPage,
    ChatConversationRecord, ChatMessageRecord,
    CustomHeaderSchemeInput, CustomHeaderSchemeRecord, McpServerConfigInput,
    McpServerConfigRecord, SensitiveCommandConfigInput, SensitiveCommandConfigRecord,
    SystemPromptItemInput, SystemPromptItemRecord, WorkspaceDirectoryInput,
    WorkspaceDirectoryRecord,
};
use crate::storage::services::fs_explorer::{DirectoryEntry, FileSearchResult};

// ============================================================================
// 所有 storage NAPI 函数均使用 async + spawn_blocking 模式，
// 确保 SQLite I/O 和文件系统操作不会阻塞 Node.js 主线程。
// ============================================================================

#[napi]
pub async fn initialize_app_storage() -> napi::Result<AppStorageInfo> {
    tokio::task::spawn_blocking(crate::storage::initialize_app_storage)
        .await
        .map_err(map_spawn_error)?
}

#[napi]
pub async fn get_system_setting_value(setting_code: String) -> napi::Result<Option<String>> {
    tokio::task::spawn_blocking(move || crate::storage::get_system_setting_value(setting_code))
        .await
        .map_err(map_spawn_error)?
}

#[napi]
pub async fn set_system_setting(
    setting_name: String,
    setting_code: String,
    setting_value: String,
) -> napi::Result<()> {
    tokio::task::spawn_blocking(move || {
        crate::storage::set_system_setting(setting_name, setting_code, setting_value)
    })
    .await
    .map_err(map_spawn_error)?
}

#[napi]
pub async fn list_api_configs() -> napi::Result<Vec<ApiConfigRecord>> {
    tokio::task::spawn_blocking(crate::storage::list_api_configs)
        .await
        .map_err(map_spawn_error)?
}

#[napi]
pub async fn upsert_api_config(config: ApiConfigInput) -> napi::Result<()> {
    tokio::task::spawn_blocking(move || crate::storage::upsert_api_config(config))
        .await
        .map_err(map_spawn_error)?
}

#[napi]
pub async fn delete_api_config(profile_name: String) -> napi::Result<()> {
    tokio::task::spawn_blocking(move || crate::storage::delete_api_config(profile_name))
        .await
        .map_err(map_spawn_error)?
}

#[napi]
pub async fn list_system_prompts() -> napi::Result<Vec<SystemPromptItemRecord>> {
    tokio::task::spawn_blocking(crate::storage::list_system_prompts)
        .await
        .map_err(map_spawn_error)?
}

#[napi]
pub async fn upsert_system_prompt(item: SystemPromptItemInput) -> napi::Result<()> {
    tokio::task::spawn_blocking(move || crate::storage::upsert_system_prompt(item))
        .await
        .map_err(map_spawn_error)?
}

#[napi]
pub async fn delete_system_prompt(prompt_id: String) -> napi::Result<()> {
    tokio::task::spawn_blocking(move || crate::storage::delete_system_prompt(prompt_id))
        .await
        .map_err(map_spawn_error)?
}

#[napi]
pub async fn list_custom_header_schemes() -> napi::Result<Vec<CustomHeaderSchemeRecord>> {
    tokio::task::spawn_blocking(crate::storage::list_custom_header_schemes)
        .await
        .map_err(map_spawn_error)?
}

#[napi]
pub async fn upsert_custom_header_scheme(item: CustomHeaderSchemeInput) -> napi::Result<()> {
    tokio::task::spawn_blocking(move || crate::storage::upsert_custom_header_scheme(item))
        .await
        .map_err(map_spawn_error)?
}

#[napi]
pub async fn delete_custom_header_scheme(scheme_id: String) -> napi::Result<()> {
    tokio::task::spawn_blocking(move || crate::storage::delete_custom_header_scheme(scheme_id))
        .await
        .map_err(map_spawn_error)?
}

#[napi]
pub async fn list_workspace_directories() -> napi::Result<Vec<WorkspaceDirectoryRecord>> {
    tokio::task::spawn_blocking(crate::storage::list_workspace_directories)
        .await
        .map_err(map_spawn_error)?
}

#[napi]
pub async fn upsert_workspace_directory(item: WorkspaceDirectoryInput) -> napi::Result<()> {
    tokio::task::spawn_blocking(move || crate::storage::upsert_workspace_directory(item))
        .await
        .map_err(map_spawn_error)?
}

#[napi]
pub async fn activate_workspace_directory(directory_id: String) -> napi::Result<()> {
    tokio::task::spawn_blocking(move || crate::storage::activate_workspace_directory(directory_id))
        .await
        .map_err(map_spawn_error)?
}

#[napi]
pub async fn reorder_workspace_directories(items: Vec<WorkspaceDirectoryInput>) -> napi::Result<()> {
    tokio::task::spawn_blocking(move || crate::storage::reorder_workspace_directories(items))
        .await
        .map_err(map_spawn_error)?
}

#[napi]
pub async fn delete_workspace_directory(directory_id: String) -> napi::Result<()> {
    tokio::task::spawn_blocking(move || crate::storage::delete_workspace_directory(directory_id))
        .await
        .map_err(map_spawn_error)?
}

#[napi]
pub async fn read_directory_entries(dir_path: String) -> napi::Result<Vec<DirectoryEntry>> {
    tokio::task::spawn_blocking(move || crate::storage::read_directory_entries(dir_path))
        .await
        .map_err(map_spawn_error)?
}

#[napi]
pub async fn search_files(root_dir: String, query: String) -> napi::Result<Vec<FileSearchResult>> {
    tokio::task::spawn_blocking(move || crate::storage::search_files(root_dir, query))
        .await
        .map_err(map_spawn_error)?
}

#[napi]
pub async fn list_mcp_server_configs() -> napi::Result<Vec<McpServerConfigRecord>> {
    tokio::task::spawn_blocking(crate::storage::list_mcp_server_configs)
        .await
        .map_err(map_spawn_error)?
}

#[napi]
pub async fn upsert_mcp_server_config(item: McpServerConfigInput) -> napi::Result<()> {
    tokio::task::spawn_blocking(move || crate::storage::upsert_mcp_server_config(item))
        .await
        .map_err(map_spawn_error)?
}

#[napi]
pub async fn delete_mcp_server_config(server_id: String) -> napi::Result<()> {
    tokio::task::spawn_blocking(move || crate::storage::delete_mcp_server_config(server_id))
        .await
        .map_err(map_spawn_error)?
}

#[napi]
pub async fn list_sensitive_command_configs() -> napi::Result<Vec<SensitiveCommandConfigRecord>> {
    tokio::task::spawn_blocking(crate::storage::list_sensitive_command_configs)
        .await
        .map_err(map_spawn_error)?
}

#[napi]
pub async fn upsert_sensitive_command_config(item: SensitiveCommandConfigInput) -> napi::Result<()> {
    tokio::task::spawn_blocking(move || crate::storage::upsert_sensitive_command_config(item))
        .await
        .map_err(map_spawn_error)?
}

#[napi]
pub async fn delete_sensitive_command_config(command_id: String, scope: String) -> napi::Result<()> {
    tokio::task::spawn_blocking(move || {
        crate::storage::delete_sensitive_command_config(command_id, scope)
    })
    .await
    .map_err(map_spawn_error)?
}

#[napi]
pub async fn list_chat_conversations(directory_id: String) -> napi::Result<Vec<ChatConversationRecord>> {
    tokio::task::spawn_blocking(move || crate::storage::list_chat_conversations(directory_id))
        .await
        .map_err(map_spawn_error)?
}

#[napi]
pub async fn list_chat_conversations_paginated(
    directory_id: String,
    limit: i32,
    offset: i32,
) -> napi::Result<ChatConversationPage> {
    tokio::task::spawn_blocking(move || {
        crate::storage::list_chat_conversations_paginated(directory_id, limit, offset)
    })
    .await
    .map_err(map_spawn_error)?
}

#[napi]
pub async fn list_pinned_conversations(directory_id: String) -> napi::Result<Vec<ChatConversationRecord>> {
    tokio::task::spawn_blocking(move || crate::storage::list_pinned_conversations(directory_id))
        .await
        .map_err(map_spawn_error)?
}

#[napi]
pub async fn get_chat_conversation(
    conversation_id: String,
) -> napi::Result<Option<ChatConversationRecord>> {
    tokio::task::spawn_blocking(move || crate::storage::get_chat_conversation(conversation_id))
        .await
        .map_err(map_spawn_error)?
}

#[napi]
pub async fn update_conversation_status(
    conversation_id: String,
    status: String,
) -> napi::Result<()> {
    tokio::task::spawn_blocking(move || {
        crate::storage::update_conversation_status(conversation_id, status)
    })
    .await
    .map_err(map_spawn_error)?
}

#[napi]
pub async fn rename_conversation(conversation_id: String, title: String) -> napi::Result<()> {
    tokio::task::spawn_blocking(move || crate::storage::rename_conversation(conversation_id, title))
        .await
        .map_err(map_spawn_error)?
}

#[napi]
pub async fn delete_conversation(conversation_id: String) -> napi::Result<()> {
    tokio::task::spawn_blocking(move || crate::storage::delete_conversation(conversation_id))
        .await
        .map_err(map_spawn_error)?
}

#[napi]
pub async fn list_chat_messages(conversation_id: String) -> napi::Result<Vec<ChatMessageRecord>> {
    tokio::task::spawn_blocking(move || crate::storage::list_chat_messages(conversation_id))
        .await
        .map_err(map_spawn_error)?
}

/// 将 tokio JoinError 转换为 napi Error
fn map_spawn_error(e: tokio::task::JoinError) -> Error {
    Error::new(
        Status::GenericFailure,
        format!("Spawned blocking task failed: {}", e),
    )
}
