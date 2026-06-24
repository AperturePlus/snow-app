use std::path::PathBuf;

use napi_derive::napi;

use crate::api::config::get_active_custom_headers;
use crate::api::conversation::{
    create_response_stream as create_conversation_response_stream,
};
use crate::api::summary::generate_conversation_summary as generate_summary;
use crate::api::models::{
    fetch_available_models as fetch_models_with_config, fetch_available_models_for_active_config,
    ApiConfigForModels, Model,
};
use crate::api::responses::{
    ResponsesApiRequest, ResponsesApiResult, ResponsesApiStreamCallback,
};
use crate::mcp::tools::{
    call_mcp_tool as call_tool, list_mcp_tools as list_all_mcp_tools, McpToolDefinition,
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

#[napi(
    ts_args_type = "request: ResponsesApiRequest, onChunk: (chunk: ResponsesApiStreamChunk) => void, streamId: string",
    ts_return_type = "Promise<ResponsesApiResult>"
)]
pub async fn create_response_stream(
    request: ResponsesApiRequest,
    on_chunk: ResponsesApiStreamCallback,
    stream_id: String,
) -> napi::Result<ResponsesApiResult> {
    create_conversation_response_stream(request, on_chunk, stream_id).await
}

#[napi]
pub fn abort_response_stream(stream_id: String) -> napi::Result<bool> {
    Ok(crate::api::cancel::cancel_stream(&stream_id))
}
#[napi(ts_return_type = "Promise<string>")]
pub async fn generate_conversation_summary(conversation_id: String) -> napi::Result<String> {
    generate_summary(conversation_id).await
}

#[napi]
pub fn list_mcp_tools() -> napi::Result<Vec<McpToolDefinition>> {
    list_all_mcp_tools()
}

#[napi]
pub fn call_mcp_tool(tool_full_name: String, args_json: String) -> napi::Result<String> {
    call_tool(tool_full_name, args_json)
}
