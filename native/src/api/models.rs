use std::collections::HashMap;
use std::time::Duration;

use napi::bindgen_prelude::*;
use napi_derive::napi;
use reqwest::{
    blocking::Client,
    header::{HeaderMap, HeaderName, HeaderValue},
    Url,
};
use serde_json::Value;

use crate::storage::{initialize_app_storage, CustomHeaderSchemeRecord};

#[napi(object)]
pub struct Model {
    pub id: String,
    pub object: String,
    pub created: i64,
    pub owned_by: String,
}


const DEFAULT_OPENAI_BASE_URL: &str = "https://api.openai.com/v1";
const DEFAULT_GEMINI_BASE_URL: &str = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_ANTHROPIC_BASE_URL: &str = "https://api.anthropic.com/v1";
const MODEL_FETCH_TIMEOUT_SECS: u64 = 15;

fn create_models_http_client() -> Result<Client> {
    Client::builder()
        .timeout(Duration::from_secs(MODEL_FETCH_TIMEOUT_SECS))
        .build()
        .map_err(|error| Error::from_reason(format!("Failed to create HTTP client: {}", error)))
}

fn normalize_base_url(base_url: &str) -> String {
    base_url.trim().trim_end_matches('/').to_string()
}

fn resolve_models_endpoint(base_url: &str, base_url_mode: &str) -> String {
    let normalized_base_url = normalize_base_url(base_url);

    if base_url_mode == "endpoint" {
        return normalized_base_url;
    }

    if base_url_mode == "auto" && is_models_endpoint(&normalized_base_url) {
        return normalized_base_url;
    }

    let base_for_append = if base_url_mode == "auto" || base_url_mode == "custom" {
        strip_known_endpoint_suffix(&normalized_base_url).unwrap_or(normalized_base_url)
    } else {
        normalized_base_url
    };

    append_models_endpoint(&base_for_append)
}

fn append_models_endpoint(base_url: &str) -> String {
    format!("{}/models", normalize_base_url(base_url))
}

fn is_models_endpoint(base_url: &str) -> bool {
    get_normalized_pathname(base_url)
        .map(|pathname| pathname.ends_with("/models"))
        .unwrap_or(false)
}

fn strip_known_endpoint_suffix(base_url: &str) -> Option<String> {
    let mut url = Url::parse(base_url).ok()?;
    let pathname = normalize_pathname(url.path());
    let known_suffix = get_known_endpoint_suffix(&pathname)?;
    let next_pathname = pathname
        .strip_suffix(known_suffix)
        .filter(|value| !value.is_empty())
        .unwrap_or("/");

    url.set_path(next_pathname);
    url.set_query(None);
    url.set_fragment(None);

    Some(normalize_base_url(url.as_str()))
}

fn get_known_endpoint_suffix(pathname: &str) -> Option<&str> {
    for suffix in [
        "/chat/completions",
        "/responses",
        "/messages",
        "/models",
    ] {
        if pathname.ends_with(suffix) {
            return Some(suffix);
        }
    }

    if let Some(index) = pathname.find("/models/") {
        if pathname.ends_with(":streamGenerateContent") {
            return Some(&pathname[index..]);
        }
    }

    None
}

fn get_normalized_pathname(base_url: &str) -> Option<String> {
    Url::parse(base_url)
        .ok()
        .map(|url| normalize_pathname(url.path()))
}

fn normalize_pathname(pathname: &str) -> String {
    let trimmed = pathname.trim_end_matches('/');
    if trimmed.is_empty() {
        "/".to_string()
    } else {
        trimmed.to_string()
    }
}

fn build_header_map(
    headers: &HashMap<String, String>,
) -> Result<HeaderMap> {
    let mut header_map = HeaderMap::new();

    for (key, value) in headers {
        let header_name = key.parse::<HeaderName>().map_err(|error| {
            Error::from_reason(format!("Invalid header name '{}': {}", key, error))
        })?;
        let header_value = HeaderValue::from_str(value).map_err(|error| {
            Error::from_reason(format!("Invalid header value for '{}': {}", key, error))
        })?;
        header_map.insert(header_name, header_value);
    }

    Ok(header_map)
}

fn build_headers(
    api_key: &str,
    custom_headers: &HashMap<String, String>,
) -> HashMap<String, String> {
    let mut headers = HashMap::new();
    headers.insert("Content-Type".to_string(), "application/json".to_string());

    for (key, value) in custom_headers {
        headers.insert(key.clone(), value.clone());
    }

    headers.insert("Accept-Encoding".to_string(), "identity".to_string());

    if !api_key.is_empty() {
        headers.insert("Authorization".to_string(), format!("Bearer {}", api_key));
    }

    headers
}

fn parse_models_response(response: reqwest::blocking::Response) -> Result<Value> {
    let response_text = response
        .text()
        .map_err(|error| Error::from_reason(format!("Failed to read models response: {}", error)))?;

    let response_text = response_text.strip_prefix('\u{feff}').unwrap_or(response_text.as_str());

    serde_json::from_str::<Value>(response_text).map_err(|error| {
        Error::from_reason(format!("Failed to parse models response: {}", error))
    })
}

fn optional_string(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(boolean) => Some(boolean.to_string()),
        _ => None,
    }
}

fn optional_timestamp(value: Option<&Value>) -> i64 {
    match value {
        Some(Value::Number(number)) => number
            .as_i64()
            .or_else(|| number.as_u64().and_then(|value| i64::try_from(value).ok()))
            .or_else(|| number.as_f64().map(|value| value as i64))
            .unwrap_or(0),
        Some(Value::String(text)) => {
            if let Ok(timestamp) = text.parse::<i64>() {
                return timestamp;
            }

            chrono::DateTime::parse_from_rfc3339(text)
                .map(|date_time| date_time.timestamp())
                .unwrap_or(0)
        }
        _ => 0,
    }
}

fn response_items<'a>(data: &'a Value, key: &str) -> Option<&'a Vec<Value>> {
    data.get(key)
        .and_then(Value::as_array)
        .or_else(|| data.as_array())
}

fn parse_openai_compatible_models(data: &Value) -> Vec<Model> {
    let Some(items) = response_items(data, "data") else {
        return Vec::new();
    };

    items
        .iter()
        .filter_map(|item| {
            let object = item.as_object()?;
            let id = optional_string(object.get("id").or_else(|| object.get("name")))?;

            Some(Model {
                id,
                object: optional_string(object.get("object").or_else(|| object.get("type")))
                    .unwrap_or_else(|| "model".to_string()),
                created: optional_timestamp(object.get("created").or_else(|| object.get("created_at"))),
                owned_by: optional_string(
                    object
                        .get("owned_by")
                        .or_else(|| object.get("owner"))
                        .or_else(|| object.get("provider")),
                )
                .unwrap_or_default(),
            })
        })
        .collect()
}

fn parse_gemini_models(data: &Value) -> Vec<Model> {
    let Some(items) = response_items(data, "models") else {
        return Vec::new();
    };

    items
        .iter()
        .filter_map(|item| {
            let object = item.as_object()?;
            let raw_id = optional_string(object.get("name").or_else(|| object.get("id")))?;
            let id = raw_id
                .strip_prefix("models/")
                .unwrap_or(raw_id.as_str())
                .to_string();

            Some(Model {
                id,
                object: "model".to_string(),
                created: optional_timestamp(object.get("created").or_else(|| object.get("created_at"))),
                owned_by: "google".to_string(),
            })
        })
        .collect()
}

fn parse_anthropic_models(data: &Value) -> Vec<Model> {
    let Some(items) = response_items(data, "data") else {
        return Vec::new();
    };

    items
        .iter()
        .filter_map(|item| {
            let object = item.as_object()?;
            let id = optional_string(object.get("id").or_else(|| object.get("name")))?;

            Some(Model {
                id,
                object: optional_string(object.get("type").or_else(|| object.get("object")))
                    .unwrap_or_else(|| "model".to_string()),
                created: optional_timestamp(object.get("created_at").or_else(|| object.get("created"))),
                owned_by: "anthropic".to_string(),
            })
        })
        .collect()
}

fn fetch_openai_models(
    models_url: &str,
    api_key: &str,
    custom_headers: &HashMap<String, String>,
) -> Result<Vec<Model>> {
    let client = create_models_http_client()?;
    let response = client
        .get(models_url)
        .headers(build_header_map(&build_headers(api_key, custom_headers))?)
        .send()
        .map_err(|error| Error::from_reason(format!("Failed to fetch models: {}", error)))?;

    if !response.status().is_success() {
        return Err(Error::from_reason(format!(
            "Failed to fetch models: {} {}",
            response.status(),
            response.status().canonical_reason().unwrap_or("Unknown")
        )));
    }

    let data = parse_models_response(response)?;

    Ok(parse_openai_compatible_models(&data))
}

fn fetch_gemini_models(base_url: &str, api_key: &str) -> Result<Vec<Model>> {
    if api_key.is_empty() {
        return Err(Error::from_reason("API key is required for Gemini API"));
    }

    let trimmed_base_url = normalize_base_url(base_url);
    let url = format!("{}/models?key={}", trimmed_base_url, api_key);

    let client = create_models_http_client()?;
    let response = client
        .get(&url)
        .header("Content-Type", "application/json")
        .send()
        .map_err(|error| Error::from_reason(format!("Failed to fetch models: {}", error)))?;

    if !response.status().is_success() {
        return Err(Error::from_reason(format!(
            "Failed to fetch models: {} {}",
            response.status(),
            response.status().canonical_reason().unwrap_or("Unknown")
        )));
    }

    let data = parse_models_response(response)?;

    Ok(parse_gemini_models(&data))
}

fn fetch_anthropic_models(
    base_url: &str,
    api_key: &str,
    custom_headers: &HashMap<String, String>,
) -> Result<Vec<Model>> {
    if api_key.is_empty() {
        return Err(Error::from_reason("API key is required for Anthropic API"));
    }

    let trimmed_base_url = normalize_base_url(base_url);
    let url = format!("{}/models", trimmed_base_url);

    let mut headers = HashMap::new();
    headers.insert("Content-Type".to_string(), "application/json".to_string());

    for (key, value) in custom_headers {
        headers.insert(key.clone(), value.clone());
    }

    if !api_key.is_empty() {
        headers.insert("x-api-key".to_string(), api_key.to_string());
        headers.insert("Authorization".to_string(), format!("Bearer {}", api_key));
    }

    let client = create_models_http_client()?;
    let response = client
        .get(&url)
        .headers(build_header_map(&headers)?)
        .send()
        .map_err(|error| Error::from_reason(format!("Failed to fetch models: {}", error)))?;

    if !response.status().is_success() {
        return Err(Error::from_reason(format!(
            "Failed to fetch models: {} {}",
            response.status(),
            response.status().canonical_reason().unwrap_or("Unknown")
        )));
    }

    let data = parse_models_response(response)?;

    let anthropic_models = parse_anthropic_models(&data);
    if !anthropic_models.is_empty() {
        return Ok(anthropic_models);
    }

    Ok(parse_openai_compatible_models(&data))
}

#[napi(object)]
pub struct ApiConfigForModels {
    pub base_url: String,
    pub base_url_mode: String,
    pub api_key: String,
    pub request_method: String,
}

pub fn fetch_available_models(
    config: &ApiConfigForModels,
    custom_headers: &HashMap<String, String>,
) -> Result<Vec<Model>> {
    let base_url = normalize_base_url(&config.base_url);

    if base_url.is_empty() {
        return Err(Error::from_reason(
            "Base URL not configured. Please configure API settings first.",
        ));
    }

    let is_default_base_url = base_url == DEFAULT_OPENAI_BASE_URL;

    let mut models = match config.request_method.as_str() {
        "gemini" => {
            let gemini_base_url = if is_default_base_url {
                DEFAULT_GEMINI_BASE_URL.to_string()
            } else {
                base_url.clone()
            };
            fetch_gemini_models(&gemini_base_url, &config.api_key)?
        }
        "anthropic" => {
            let anthropic_base_url = if is_default_base_url {
                DEFAULT_ANTHROPIC_BASE_URL.to_string()
            } else {
                base_url.clone()
            };
            fetch_anthropic_models(&anthropic_base_url, &config.api_key, custom_headers)?
        }
        _ => {
            let openai_base_url = if is_default_base_url {
                DEFAULT_OPENAI_BASE_URL.to_string()
            } else {
                base_url.clone()
            };
            fetch_openai_models(
                &resolve_models_endpoint(&openai_base_url, &config.base_url_mode),
                &config.api_key,
                custom_headers,
            )?
        }
    };

    models.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(models)
}

pub fn get_active_custom_headers(
    schemes: &[CustomHeaderSchemeRecord],
) -> HashMap<String, String> {
    let active = schemes.iter().find(|scheme| scheme.is_active);

    let Some(scheme) = active else {
        return HashMap::new();
    };

    let Ok(parsed) = serde_json::from_str::<Value>(&scheme.headers_json) else {
        return HashMap::new();
    };

    let Some(object) = parsed.as_object() else {
        return HashMap::new();
    };

    object
        .iter()
        .filter_map(|(key, value)| {
            value
                .as_str()
                .map(|value| (key.clone(), value.to_string()))
        })
        .collect()
}

#[napi]
pub fn fetch_available_models_for_active_config() -> Result<Vec<Model>> {
    let storage_info = initialize_app_storage()?;
    let database_path = std::path::PathBuf::from(storage_info.database_path);

    let configs = crate::storage::services::api_configs::list_api_configs(&database_path)?;
    let active_config = configs
        .iter()
        .find(|config| config.is_active)
        .or_else(|| configs.first())
        .ok_or_else(|| Error::from_reason("No API configuration found"))?;

    let custom_header_schemes =
        crate::storage::services::custom_header_schemes::list_custom_header_schemes(&database_path)?;
    let custom_headers = get_active_custom_headers(&custom_header_schemes);

    let config = ApiConfigForModels {
        base_url: active_config.base_url.clone(),
        base_url_mode: active_config.base_url_mode.clone(),
        api_key: active_config.api_key.clone(),
        request_method: active_config.request_method.clone(),
    };

    fetch_available_models(&config, &custom_headers)
}
