use std::collections::HashMap;

use napi::bindgen_prelude::*;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, ACCEPT_ENCODING, AUTHORIZATION, CONTENT_TYPE};
use serde_json::{json, Value};
use crate::api::config::{
    get_active_api_request_context, normalize_base_url, resolve_sdk_api_base_url,
    DEFAULT_ANTHROPIC_BASE_URL, DEFAULT_GEMINI_BASE_URL, DEFAULT_OPENAI_BASE_URL,
};
use crate::api::retry::{RetryOptions, should_retry};
use crate::storage::services::chat_conversations::{load_context_messages, update_conversation_summary};

const SUMMARY_SYSTEM_PROMPT: &str = "You are a conversation title generator. Based on the conversation below, generate a concise title (max 50 characters) that captures the main topic. Respond with only the title text, no quotes, no additional explanation.";

pub async fn generate_conversation_summary(conversation_id: String) -> Result<String> {
    let context = get_active_api_request_context()?;
    let database_path = context.database_path;
    let api_config = context.api_config;
    let custom_headers = context.custom_headers;

    let messages = load_context_messages(&database_path, &conversation_id)?;
    if messages.is_empty() {
        return Ok(String::new());
    }

    let model = api_config.basic_model.trim();
    if model.is_empty() {
        return Err(Error::from_reason(
            "Basic model not configured. Please configure a basic model in API settings.",
        ));
    }

    let api_key = api_config.api_key.trim();
    if api_key.is_empty() {
        return Err(Error::from_reason(
            "API key not configured. Please configure API settings first.",
        ));
    }

    let retry_options = RetryOptions::from_config(api_config.max_retries, api_config.retry_base_delay_ms);

    let summary_text = match api_config.request_method.as_str() {
        "responses" => {
            generate_summary_via_responses(
                &api_config,
                &api_key,
                &custom_headers,
                model,
                &messages,
                &retry_options,
            )
            .await?
        }
        "anthropic" => {
            generate_summary_via_anthropic(
                &api_config,
                &api_key,
                &custom_headers,
                model,
                &messages,
                &retry_options,
            )
            .await?
        }
        "gemini" => {
            generate_summary_via_gemini(
                &api_config,
                &api_key,
                &custom_headers,
                model,
                &messages,
                &retry_options,
            )
            .await?
        }
        _ => {
            generate_summary_via_chat(
                &api_config,
                &api_key,
                &custom_headers,
                model,
                &messages,
                &retry_options,
            )
            .await?
        }
    };

    let trimmed = summary_text.trim();
    if trimmed.is_empty() {
        return Ok(String::new());
    }

    update_conversation_summary(&database_path, &conversation_id, trimmed)?;

    Ok(trimmed.to_string())
}

async fn generate_summary_via_chat(
    api_config: &crate::storage::ApiConfigRecord,
    api_key: &str,
    custom_headers: &HashMap<String, String>,
    model: &str,
    messages: &[crate::storage::services::chat_conversations::ChatContextMessage],
    retry_options: &RetryOptions,
) -> Result<String> {
    let endpoint = resolve_chat_endpoint(api_config);
    if endpoint.is_empty() {
        return Err(Error::from_reason(
            "Base URL not configured. Please configure API settings first.",
        ));
    }

    let chat_messages = build_summary_chat_messages(messages);
    let payload = json!({
        "model": model,
        "messages": chat_messages,
        "stream": false,
        "max_tokens": 4096,
    });

    let client = reqwest::Client::builder()
        .build()
        .map_err(|error| Error::from_reason(format!("Failed to create HTTP client: {}", error)))?;

    let body: Value = send_summary_request_with_retry(
        &client,
        &endpoint,
        build_header_map(api_key, custom_headers)?,
        &payload,
        retry_options,
    )
    .await?;

    let content = body
        .get("choices")
        .and_then(|choices| choices.get(0))
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(Value::as_str)
        .unwrap_or("");

    Ok(content.to_string())
}

async fn generate_summary_via_responses(
    api_config: &crate::storage::ApiConfigRecord,
    api_key: &str,
    custom_headers: &HashMap<String, String>,
    model: &str,
    messages: &[crate::storage::services::chat_conversations::ChatContextMessage],
    retry_options: &RetryOptions,
) -> Result<String> {
    let base_url = normalize_base_url(&api_config.base_url);
    if base_url.is_empty() {
        return Err(Error::from_reason(
            "Base URL not configured. Please configure API settings first.",
        ));
    }

    let resolved_base = resolve_sdk_api_base_url(&base_url, &api_config.base_url_mode);
    let endpoint = format!("{}/responses", resolved_base);

    let input = build_summary_responses_input(messages);
    let payload = json!({
        "model": model,
        "input": input,
        "stream": false,
    });

    let client = reqwest::Client::builder()
        .build()
        .map_err(|error| Error::from_reason(format!("Failed to create HTTP client: {}", error)))?;

    let body: Value = send_summary_request_with_retry(
        &client,
        &endpoint,
        build_header_map(api_key, custom_headers)?,
        &payload,
        retry_options,
    )
    .await?;

    let content = extract_responses_content(&body);

    Ok(content)
}

async fn generate_summary_via_anthropic(
    api_config: &crate::storage::ApiConfigRecord,
    api_key: &str,
    custom_headers: &HashMap<String, String>,
    model: &str,
    messages: &[crate::storage::services::chat_conversations::ChatContextMessage],
    retry_options: &RetryOptions,
) -> Result<String> {
    let endpoint = resolve_anthropic_endpoint(api_config);
    if endpoint.is_empty() {
        return Err(Error::from_reason(
            "Base URL not configured. Please configure API settings first.",
        ));
    }

    let conversation_text = build_conversation_text(messages);
    let payload = json!({
        "model": model,
        "max_tokens": 4096,
        "stream": false,
        "system": SUMMARY_SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": conversation_text}],
    });

    let client = reqwest::Client::builder()
        .build()
        .map_err(|error| Error::from_reason(format!("Failed to create HTTP client: {}", error)))?;

    let body: Value = send_summary_request_with_retry(
        &client,
        &endpoint,
        build_anthropic_header_map(api_key, custom_headers)?,
        &payload,
        retry_options,
    )
    .await?;

    let content = extract_anthropic_content(&body);

    Ok(content)
}

async fn generate_summary_via_gemini(
    api_config: &crate::storage::ApiConfigRecord,
    api_key: &str,
    custom_headers: &HashMap<String, String>,
    model: &str,
    messages: &[crate::storage::services::chat_conversations::ChatContextMessage],
    retry_options: &RetryOptions,
) -> Result<String> {
    let endpoint = resolve_gemini_endpoint(api_config, model, api_key);
    if endpoint.is_empty() {
        return Err(Error::from_reason(
            "Base URL not configured. Please configure API settings first.",
        ));
    }

    let conversation_text = build_conversation_text(messages);
    let payload = json!({
        "systemInstruction": {
            "parts": [{"text": SUMMARY_SYSTEM_PROMPT}]
        },
        "contents": [{
            "role": "user",
            "parts": [{"text": conversation_text}]
        }],
        "generationConfig": {
            "maxOutputTokens": 4096
        }
    });

    let client = reqwest::Client::builder()
        .build()
        .map_err(|error| Error::from_reason(format!("Failed to create HTTP client: {}", error)))?;

    let body: Value = send_summary_request_with_retry(
        &client,
        &endpoint,
        build_gemini_header_map(custom_headers)?,
        &payload,
        retry_options,
    )
    .await?;

    let content = body
        .get("candidates")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .and_then(|item| item.get("content"))
        .and_then(|content| content.get("parts"))
        .and_then(Value::as_array)
        .and_then(|parts| parts.first())
        .and_then(|part| part.get("text"))
        .and_then(Value::as_str)
        .unwrap_or("");

    Ok(content.to_string())
}

/// Send a non-streaming summary request with retry logic.
/// Wraps the HTTP send + status check + JSON parse in a retry loop.
async fn send_summary_request_with_retry(
    client: &reqwest::Client,
    endpoint: &str,
    headers: reqwest::header::HeaderMap,
    payload: &Value,
    retry_options: &RetryOptions,
) -> Result<Value> {
    let mut attempt: u32 = 0;
    loop {
        let response = client
            .post(endpoint)
            .headers(headers.clone())
            .json(payload)
            .send()
            .await
            .map_err(|error| {
                Error::from_reason(format!("Summary request failed: {}", error))
            });

        match response {
            Ok(response) => {
                let status = response.status();
                if !status.is_success() {
                    let error_body = response.text().await.unwrap_or_default();
                    let error = Error::from_reason(format!(
                        "Summary request failed: {} {}",
                        status, error_body
                    ));

                    if !should_retry(&error, attempt, retry_options) {
                        return Err(error);
                    }

                    attempt += 1;
                    let delay = std::time::Duration::from_millis(retry_options.base_delay_ms);
                    tokio::time::sleep(delay).await;
                    continue;
                }

                let body: Value = response
                    .json()
                    .await
                    .map_err(|error| {
                        Error::from_reason(format!(
                            "Failed to parse summary response: {}",
                            error
                        ))
                    })?;

                return Ok(body);
            }
            Err(error) => {
                if !should_retry(&error, attempt, retry_options) {
                    return Err(error);
                }

                attempt += 1;
                let delay = std::time::Duration::from_millis(retry_options.base_delay_ms);
                tokio::time::sleep(delay).await;
                continue;
            }
        }
    }
}

fn build_conversation_text(
    messages: &[crate::storage::services::chat_conversations::ChatContextMessage],
) -> String {
    messages
        .iter()
        .filter_map(|message| {
            let content = message.content.trim();
            if content.is_empty() {
                return None;
            }
            let role = normalize_role(&message.role);
            Some(format!("{}: {}", role, content))
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn extract_anthropic_content(body: &Value) -> String {
    let Some(content_array) = body.get("content").and_then(Value::as_array) else {
        return String::new();
    };

    for block in content_array {
        let block_type = block
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if block_type == "text" {
            if let Some(text) = block
                .get("text")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|text| !text.is_empty())
            {
                return text.to_string();
            }
        }
    }

    for block in content_array {
        if let Some(text) = block
            .get("text")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty())
        {
            return text.to_string();
        }
    }

    String::new()
}

fn resolve_anthropic_endpoint(api_config: &crate::storage::ApiConfigRecord) -> String {
    let normalized_base_url = normalize_base_url(&api_config.base_url);
    if normalized_base_url.is_empty() {
        return String::new();
    }

    let base_url = if normalized_base_url == DEFAULT_OPENAI_BASE_URL {
        DEFAULT_ANTHROPIC_BASE_URL.to_string()
    } else {
        normalized_base_url
    };

    if api_config.base_url_mode == "endpoint" {
        return base_url;
    }

    let resolved_base = resolve_sdk_api_base_url(&base_url, &api_config.base_url_mode);
    format!("{}/messages", resolved_base)
}

fn resolve_gemini_endpoint(
    api_config: &crate::storage::ApiConfigRecord,
    model: &str,
    api_key: &str,
) -> String {
    let normalized_base_url = normalize_base_url(&api_config.base_url);
    if normalized_base_url.is_empty() {
        return String::new();
    }

    let base_url = if normalized_base_url == DEFAULT_OPENAI_BASE_URL {
        DEFAULT_GEMINI_BASE_URL.to_string()
    } else {
        normalized_base_url
    };

    let resolved_base = if api_config.base_url_mode == "endpoint" {
        base_url
    } else {
        resolve_sdk_api_base_url(&base_url, &api_config.base_url_mode)
    };

    let clean_model = model.strip_prefix("models/").unwrap_or(model);

    let mut url = format!(
        "{}/models/{}:generateContent",
        resolved_base, clean_model
    );

    if !api_key.is_empty() {
        url.push_str(&format!("?key={}", api_key));
    }

    url
}

fn build_anthropic_header_map(
    api_key: &str,
    custom_headers: &HashMap<String, String>,
) -> Result<HeaderMap> {
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert(ACCEPT_ENCODING, HeaderValue::from_static("identity"));
    headers.insert(
        HeaderName::from_static("x-api-key"),
        HeaderValue::from_str(api_key).map_err(|error| {
            Error::from_reason(format!("Invalid API key header value: {}", error))
        })?,
    );
    headers.insert(
        HeaderName::from_static("anthropic-version"),
        HeaderValue::from_static("2023-06-01"),
    );

    for (key, value) in custom_headers {
        let trimmed_key = key.trim();
        let trimmed_value = value.trim();
        if trimmed_key.is_empty() || trimmed_value.is_empty() {
            continue;
        }

        if trimmed_key.eq_ignore_ascii_case("content-type")
            || trimmed_key.eq_ignore_ascii_case("accept-encoding")
            || trimmed_key.eq_ignore_ascii_case("x-api-key")
            || trimmed_key.eq_ignore_ascii_case("anthropic-version")
        {
            continue;
        }

        let header_name = trimmed_key.parse::<HeaderName>().map_err(|error| {
            Error::from_reason(format!("Invalid custom header '{}': {}", trimmed_key, error))
        })?;
        let header_value = HeaderValue::from_str(trimmed_value).map_err(|error| {
            Error::from_reason(format!(
                "Invalid custom header value for '{}': {}",
                trimmed_key, error
            ))
        })?;
        headers.insert(header_name, header_value);
    }

    Ok(headers)
}

fn build_gemini_header_map(
    custom_headers: &HashMap<String, String>,
) -> Result<HeaderMap> {
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert(ACCEPT_ENCODING, HeaderValue::from_static("identity"));

    for (key, value) in custom_headers {
        let trimmed_key = key.trim();
        let trimmed_value = value.trim();
        if trimmed_key.is_empty() || trimmed_value.is_empty() {
            continue;
        }

        if trimmed_key.eq_ignore_ascii_case("content-type")
            || trimmed_key.eq_ignore_ascii_case("accept-encoding")
        {
            continue;
        }

        let header_name = trimmed_key.parse::<HeaderName>().map_err(|error| {
            Error::from_reason(format!("Invalid custom header '{}': {}", trimmed_key, error))
        })?;
        let header_value = HeaderValue::from_str(trimmed_value).map_err(|error| {
            Error::from_reason(format!(
                "Invalid custom header value for '{}': {}",
                trimmed_key, error
            ))
        })?;
        headers.insert(header_name, header_value);
    }

    Ok(headers)
}

fn resolve_chat_endpoint(api_config: &crate::storage::ApiConfigRecord) -> String {
    let normalized_base_url = normalize_base_url(&api_config.base_url);
    if normalized_base_url.is_empty() {
        return String::new();
    }

    if api_config.base_url_mode == "endpoint" {
        normalized_base_url
    } else {
        format!(
            "{}/chat/completions",
            resolve_sdk_api_base_url(&normalized_base_url, &api_config.base_url_mode)
        )
    }
}

fn build_summary_chat_messages(
    messages: &[crate::storage::services::chat_conversations::ChatContextMessage],
) -> Vec<Value> {
    let conversation_text = messages
        .iter()
        .filter_map(|message| {
            let content = message.content.trim();
            if content.is_empty() {
                return None;
            }
            let role = normalize_role(&message.role);
            Some(format!("{}: {}", role, content))
        })
        .collect::<Vec<_>>()
        .join("\n");

    vec![
        json!({
            "role": "system",
            "content": SUMMARY_SYSTEM_PROMPT,
        }),
        json!({
            "role": "user",
            "content": conversation_text,
        }),
    ]
}

fn build_summary_responses_input(
    messages: &[crate::storage::services::chat_conversations::ChatContextMessage],
) -> Vec<Value> {
    let conversation_text = messages
        .iter()
        .filter_map(|message| {
            let content = message.content.trim();
            if content.is_empty() {
                return None;
            }
            let role = normalize_role(&message.role);
            Some(format!("{}: {}", role, content))
        })
        .collect::<Vec<_>>()
        .join("\n");

    vec![
        json!({
            "type": "message",
            "role": "system",
            "content": SUMMARY_SYSTEM_PROMPT,
        }),
        json!({
            "type": "message",
            "role": "user",
            "content": conversation_text,
        }),
    ]
}

fn extract_responses_content(body: &Value) -> String {
    if let Some(output) = body.get("output").and_then(Value::as_array) {
        for item in output {
            if let Some(content) = item.get("content").and_then(Value::as_array) {
                for part in content {
                    if let Some(text) = part.get("text").and_then(Value::as_str) {
                        if !text.is_empty() {
                            return text.to_string();
                        }
                    }
                    if let Some(text) = part
                        .get("output_text")
                        .and_then(Value::as_str)
                    {
                        if !text.is_empty() {
                            return text.to_string();
                        }
                    }
                }
            }
        }
    }

    body.get("output_text")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

fn normalize_role(role: &str) -> &str {
    match role.trim() {
        "assistant" => "Assistant",
        "system" => "System",
        "developer" => "Developer",
        _ => "User",
    }
}

fn build_header_map(api_key: &str, custom_headers: &HashMap<String, String>) -> Result<HeaderMap> {
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert(ACCEPT_ENCODING, HeaderValue::from_static("identity"));
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {}", api_key)).map_err(|error| {
            Error::from_reason(format!("Invalid authorization header value: {}", error))
        })?,
    );

    for (key, value) in custom_headers {
        let trimmed_key = key.trim();
        let trimmed_value = value.trim();
        if trimmed_key.is_empty() || trimmed_value.is_empty() {
            continue;
        }

        if trimmed_key.eq_ignore_ascii_case("content-type")
            || trimmed_key.eq_ignore_ascii_case("accept-encoding")
            || trimmed_key.eq_ignore_ascii_case("authorization")
        {
            continue;
        }

        let header_name = trimmed_key.parse::<HeaderName>().map_err(|error| {
            Error::from_reason(format!("Invalid custom header '{}': {}", trimmed_key, error))
        })?;
        let header_value = HeaderValue::from_str(trimmed_value).map_err(|error| {
            Error::from_reason(format!(
                "Invalid custom header value for '{}': {}",
                trimmed_key, error
            ))
        })?;
        headers.insert(header_name, header_value);
    }

    Ok(headers)
}
