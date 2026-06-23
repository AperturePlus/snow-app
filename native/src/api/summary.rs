use std::collections::HashMap;

use napi::bindgen_prelude::*;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, ACCEPT_ENCODING, AUTHORIZATION, CONTENT_TYPE};
use serde_json::{json, Value};

use crate::api::config::{
    get_active_api_request_context, normalize_base_url, resolve_sdk_api_base_url,
};
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

    let summary_text = match api_config.request_method.as_str() {
        "responses" => {
            generate_summary_via_responses(
                &api_config,
                &api_key,
                &custom_headers,
                model,
                &messages,
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
        "max_tokens": 100,
    });

    let client = reqwest::Client::builder()
        .build()
        .map_err(|error| Error::from_reason(format!("Failed to create HTTP client: {}", error)))?;

    let response = client
        .post(&endpoint)
        .headers(build_header_map(api_key, custom_headers)?)
        .json(&payload)
        .send()
        .await
        .map_err(|error| Error::from_reason(format!("Summary request failed: {}", error)))?;

    let status = response.status();
    if !status.is_success() {
        let error_body = response.text().await.unwrap_or_default();
        return Err(Error::from_reason(format!(
            "Summary request failed: {} {}",
            status, error_body
        )));
    }

    let body: Value = response
        .json()
        .await
        .map_err(|error| Error::from_reason(format!("Failed to parse summary response: {}", error)))?;

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

    let response = client
        .post(&endpoint)
        .headers(build_header_map(api_key, custom_headers)?)
        .json(&payload)
        .send()
        .await
        .map_err(|error| Error::from_reason(format!("Summary request failed: {}", error)))?;

    let status = response.status();
    if !status.is_success() {
        let error_body = response.text().await.unwrap_or_default();
        return Err(Error::from_reason(format!(
            "Summary request failed: {} {}",
            status, error_body
        )));
    }

    let body: Value = response
        .json()
        .await
        .map_err(|error| Error::from_reason(format!("Failed to parse summary response: {}", error)))?;

    let content = extract_responses_content(&body);

    Ok(content)
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
