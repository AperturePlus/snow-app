mod database;
mod paths;
mod services;

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
    pub config_json: String,
    pub source: String,
}

#[napi(object)]
pub struct ApiConfigRecord {
    pub id: i32,
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
    pub vision_api_key: String,
    pub vision_request_method: String,
    pub vision_model: String,
    pub max_context_tokens: Option<i32>,
    pub max_tokens: Option<i32>,
    pub stream_idle_timeout_sec: Option<i32>,
    pub source: String,
    pub updated_at: String,
}

#[napi(object)]
pub struct CodebaseSettingsInput {
    pub profile_name: String,
    pub enabled: bool,
    pub enable_agent_review: bool,
    pub enable_reranking: bool,
    pub embedding_type: String,
    pub embedding_model_name: String,
    pub embedding_base_url: String,
    pub embedding_api_key: String,
    pub embedding_dimensions: i32,
    pub batch_max_lines: i32,
    pub batch_concurrency: i32,
    pub chunking_max_lines_per_chunk: i32,
    pub chunking_min_lines_per_chunk: i32,
    pub chunking_min_chars_per_chunk: i32,
    pub chunking_overlap_lines: i32,
    pub reranking_model_name: String,
    pub reranking_base_url: String,
    pub reranking_api_key: String,
    pub reranking_context_length: i32,
    pub reranking_top_n: i32,
    pub config_json: String,
    pub source: String,
}

#[napi(object)]
pub struct CodebaseSettingsRecord {
    pub id: i32,
    pub profile_name: String,
    pub enabled: bool,
    pub enable_agent_review: bool,
    pub enable_reranking: bool,
    pub embedding_type: String,
    pub embedding_model_name: String,
    pub embedding_base_url: String,
    pub embedding_api_key: String,
    pub embedding_dimensions: i32,
    pub batch_max_lines: i32,
    pub batch_concurrency: i32,
    pub chunking_max_lines_per_chunk: i32,
    pub chunking_min_lines_per_chunk: i32,
    pub chunking_min_chars_per_chunk: i32,
    pub chunking_overlap_lines: i32,
    pub reranking_model_name: String,
    pub reranking_base_url: String,
    pub reranking_api_key: String,
    pub reranking_context_length: i32,
    pub reranking_top_n: i32,
    pub config_json: String,
    pub source: String,
    pub updated_at: String,
}

pub fn initialize_app_storage() -> Result<AppStorageInfo> {
    let storage_dir = ensure_storage_dir()?;
    let database_path = paths::database_file_path(&storage_dir);
    database::ensure_database(&database_path)?;
    services::system_settings::seed_default_settings(&database_path)?;
    services::api_configs::seed_default_api_config(&database_path)?;

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

pub fn get_codebase_settings() -> Result<CodebaseSettingsRecord> {
    let database_path = ensure_database_file()?;
    services::codebase_settings::get_codebase_settings(&database_path)
}

pub fn upsert_codebase_settings(settings: CodebaseSettingsInput) -> Result<()> {
    let database_path = ensure_database_file()?;
    services::codebase_settings::upsert_codebase_settings(&database_path, &settings)
}

fn ensure_database_file() -> Result<PathBuf> {
    let storage_dir = ensure_storage_dir()?;
    let database_path = paths::database_file_path(&storage_dir);
    database::ensure_database(&database_path)?;
    services::system_settings::seed_default_settings(&database_path)?;
    services::api_configs::seed_default_api_config(&database_path)?;
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
