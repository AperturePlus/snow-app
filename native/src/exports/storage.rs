use napi_derive::napi;

use crate::storage::{
    ApiConfigInput, ApiConfigRecord, AppStorageInfo, ChatConversationPage,
    ChatConversationRecord, ChatMessageRecord, CodebaseSettingsInput, CodebaseSettingsRecord,
    CustomHeaderSchemeInput, CustomHeaderSchemeRecord, McpServerConfigInput,
    McpServerConfigRecord, SensitiveCommandConfigInput, SensitiveCommandConfigRecord,
    SystemPromptItemInput, SystemPromptItemRecord, WorkspaceDirectoryInput,
    WorkspaceDirectoryRecord,
};
use crate::storage::services::fs_explorer::DirectoryEntry;

#[napi]
pub fn initialize_app_storage() -> napi::Result<AppStorageInfo> {
    crate::storage::initialize_app_storage()
}

#[napi]
pub fn get_system_setting_value(setting_code: String) -> napi::Result<Option<String>> {
    crate::storage::get_system_setting_value(setting_code)
}

#[napi]
pub fn set_system_setting(
    setting_name: String,
    setting_code: String,
    setting_value: String,
) -> napi::Result<()> {
    crate::storage::set_system_setting(setting_name, setting_code, setting_value)
}

#[napi]
pub fn list_api_configs() -> napi::Result<Vec<ApiConfigRecord>> {
    crate::storage::list_api_configs()
}

#[napi]
pub fn upsert_api_config(config: ApiConfigInput) -> napi::Result<()> {
    crate::storage::upsert_api_config(config)
}

#[napi]
pub fn delete_api_config(profile_name: String) -> napi::Result<()> {
    crate::storage::delete_api_config(profile_name)
}

#[napi]
pub fn get_codebase_settings() -> napi::Result<CodebaseSettingsRecord> {
    crate::storage::get_codebase_settings()
}

#[napi]
pub fn upsert_codebase_settings(settings: CodebaseSettingsInput) -> napi::Result<()> {
    crate::storage::upsert_codebase_settings(settings)
}

#[napi]
pub fn list_system_prompts() -> napi::Result<Vec<SystemPromptItemRecord>> {
    crate::storage::list_system_prompts()
}

#[napi]
pub fn upsert_system_prompt(item: SystemPromptItemInput) -> napi::Result<()> {
    crate::storage::upsert_system_prompt(item)
}

#[napi]
pub fn delete_system_prompt(prompt_id: String) -> napi::Result<()> {
    crate::storage::delete_system_prompt(prompt_id)
}

#[napi]
pub fn list_custom_header_schemes() -> napi::Result<Vec<CustomHeaderSchemeRecord>> {
    crate::storage::list_custom_header_schemes()
}

#[napi]
pub fn upsert_custom_header_scheme(item: CustomHeaderSchemeInput) -> napi::Result<()> {
    crate::storage::upsert_custom_header_scheme(item)
}

#[napi]
pub fn delete_custom_header_scheme(scheme_id: String) -> napi::Result<()> {
    crate::storage::delete_custom_header_scheme(scheme_id)
}

#[napi]
pub fn list_workspace_directories() -> napi::Result<Vec<WorkspaceDirectoryRecord>> {
    crate::storage::list_workspace_directories()
}

#[napi]
pub fn upsert_workspace_directory(item: WorkspaceDirectoryInput) -> napi::Result<()> {
    crate::storage::upsert_workspace_directory(item)
}

#[napi]
pub fn activate_workspace_directory(directory_id: String) -> napi::Result<()> {
    crate::storage::activate_workspace_directory(directory_id)
}

#[napi]
pub fn reorder_workspace_directories(items: Vec<WorkspaceDirectoryInput>) -> napi::Result<()> {
    crate::storage::reorder_workspace_directories(items)
}

#[napi]
pub fn delete_workspace_directory(directory_id: String) -> napi::Result<()> {
    crate::storage::delete_workspace_directory(directory_id)
}

#[napi]
pub fn read_directory_entries(dir_path: String) -> napi::Result<Vec<DirectoryEntry>> {
    crate::storage::read_directory_entries(dir_path)
}

#[napi]
pub fn list_mcp_server_configs() -> napi::Result<Vec<McpServerConfigRecord>> {
    crate::storage::list_mcp_server_configs()
}

#[napi]
pub fn upsert_mcp_server_config(item: McpServerConfigInput) -> napi::Result<()> {
    crate::storage::upsert_mcp_server_config(item)
}

#[napi]
pub fn delete_mcp_server_config(server_id: String) -> napi::Result<()> {
    crate::storage::delete_mcp_server_config(server_id)
}

#[napi]
pub fn list_sensitive_command_configs() -> napi::Result<Vec<SensitiveCommandConfigRecord>> {
    crate::storage::list_sensitive_command_configs()
}

#[napi]
pub fn upsert_sensitive_command_config(item: SensitiveCommandConfigInput) -> napi::Result<()> {
    crate::storage::upsert_sensitive_command_config(item)
}

#[napi]
pub fn delete_sensitive_command_config(command_id: String, scope: String) -> napi::Result<()> {
    crate::storage::delete_sensitive_command_config(command_id, scope)
}

#[napi]
pub fn list_chat_conversations(directory_id: String) -> napi::Result<Vec<ChatConversationRecord>> {
    crate::storage::list_chat_conversations(directory_id)
}

#[napi]
pub fn list_chat_conversations_paginated(
    directory_id: String,
    limit: i32,
    offset: i32,
) -> napi::Result<ChatConversationPage> {
    crate::storage::list_chat_conversations_paginated(directory_id, limit, offset)
}

#[napi]
pub fn list_pinned_conversations(directory_id: String) -> napi::Result<Vec<ChatConversationRecord>> {
    crate::storage::list_pinned_conversations(directory_id)
}

#[napi]
pub fn get_chat_conversation(
    conversation_id: String,
) -> napi::Result<Option<ChatConversationRecord>> {
    crate::storage::get_chat_conversation(conversation_id)
}

#[napi]
pub fn update_conversation_status(
    conversation_id: String,
    status: String,
) -> napi::Result<()> {
    crate::storage::update_conversation_status(conversation_id, status)
}

#[napi]
pub fn rename_conversation(conversation_id: String, title: String) -> napi::Result<()> {
    crate::storage::rename_conversation(conversation_id, title)
}
#[napi]
pub fn delete_conversation(conversation_id: String) -> napi::Result<()> {
    crate::storage::delete_conversation(conversation_id)
}

#[napi]
pub fn list_chat_messages(conversation_id: String) -> napi::Result<Vec<ChatMessageRecord>> {
    crate::storage::list_chat_messages(conversation_id)
}
