use std::path::PathBuf;

use napi_derive::napi;

use crate::api::models::{
    fetch_available_models as fetch_models_with_config, fetch_available_models_for_active_config,
    get_active_custom_headers, ApiConfigForModels, Model,
};
use crate::storage::initialize_app_storage;

#[napi]
pub fn fetch_available_models() -> napi::Result<Vec<Model>> {
    fetch_available_models_for_active_config()
}

#[napi]
pub fn fetch_available_models_for_config(config: ApiConfigForModels) -> napi::Result<Vec<Model>> {
    let storage_info = initialize_app_storage()?;
    let database_path = PathBuf::from(storage_info.database_path);
    let custom_header_schemes =
        crate::storage::services::custom_header_schemes::list_custom_header_schemes(&database_path)?;
    let custom_headers = get_active_custom_headers(&custom_header_schemes);

    fetch_models_with_config(&config, &custom_headers)
}
