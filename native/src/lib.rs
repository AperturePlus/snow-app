mod storage;

use napi_derive::napi;
use storage::{ApiConfigInput, ApiConfigRecord, AppStorageInfo};

#[napi]
pub fn initialize_app_storage() -> napi::Result<AppStorageInfo> {
    storage::initialize_app_storage()
}

#[napi]
pub fn get_system_setting_value(setting_code: String) -> napi::Result<Option<String>> {
    storage::get_system_setting_value(setting_code)
}

#[napi]
pub fn set_system_setting(
    setting_name: String,
    setting_code: String,
    setting_value: String,
) -> napi::Result<()> {
    storage::set_system_setting(setting_name, setting_code, setting_value)
}

#[napi]
pub fn list_api_configs() -> napi::Result<Vec<ApiConfigRecord>> {
    storage::list_api_configs()
}

#[napi]
pub fn upsert_api_config(config: ApiConfigInput) -> napi::Result<()> {
    storage::upsert_api_config(config)
}

#[napi]
pub fn delete_api_config(profile_name: String) -> napi::Result<()> {
    storage::delete_api_config(profile_name)
}

#[napi]
pub fn engine_info() -> String {
    format!(
        "snow-native {} on {} ({})",
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS,
        std::env::consts::ARCH
    )
}

#[napi]
pub fn sum(a: i32, b: i32) -> i32 {
    a + b
}
