use napi_derive::napi;

use crate::storage::{
    ApiConfigInput, ApiConfigRecord, AppStorageInfo, CodebaseSettingsInput, CodebaseSettingsRecord,
};

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
