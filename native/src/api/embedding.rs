use std::time::Duration;

use napi::bindgen_prelude::*;
use reqwest::header::{HeaderMap, HeaderValue};
use serde_json::{json, Value};

use crate::api::config::normalize_base_url;

/// Configuration for the embedding API, derived from the codebase settings.
#[derive(Debug, Clone)]
pub struct EmbeddingConfig {
    pub embedding_type: String,
    pub model_name: String,
    pub base_url: String,
    pub api_key: String,
    pub dimensions: usize,
}

impl EmbeddingConfig {
    pub fn from_settings(
        embedding_type: &str,
        model_name: &str,
        base_url: &str,
        api_key: &str,
        dimensions: i32,
    ) -> Self {
        Self {
            embedding_type: embedding_type.to_string(),
            model_name: model_name.to_string(),
            base_url: normalize_base_url(base_url),
            api_key: api_key.to_string(),
            dimensions: if dimensions > 0 { dimensions as usize } else { 1536 },
        }
    }
}

/// Embed a batch of text inputs and return their vector representations.
///
/// This function is fully async and uses `reqwest`'s async client, so it
/// never blocks the Node.js main thread. It supports two embedding types:
///
/// - `openai`: Standard OpenAI-compatible `/v1/embeddings` endpoint.
///   Supports batch requests (multiple inputs per API call).
/// - `jina`: Jina AI embedding API (also OpenAI-compatible format).
///
/// Both types use the same request/response format, differing only in
/// authentication header conventions.
pub async fn embed_batch(
    config: &EmbeddingConfig,
    inputs: &[String],
) -> Result<Vec<Vec<f64>>> {
    if inputs.is_empty() {
        return Ok(Vec::new());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|error| {
            Error::from_reason(format!("Failed to create HTTP client: {error}"))
        })?;

    let endpoint = resolve_embedding_endpoint(&config.base_url, &config.embedding_type);
    let headers = build_headers(config);
    let body = build_request_body(config, inputs);

    let response = client
        .post(&endpoint)
        .headers(headers)
        .json(&body)
        .send()
        .await
        .map_err(|error| {
            Error::from_reason(format!(
                "Embedding API request failed: {error}"
            ))
        })?;

    let status = response.status();
    let response_text = response
        .text()
        .await
        .map_err(|error| Error::from_reason(format!("Failed to read embedding response: {error}")))?;

    if !status.is_success() {
        return Err(Error::from_reason(format!(
            "Embedding API returned status {}: {}",
            status,
            truncate_error(&response_text, 500)
        )));
    }

    parse_embedding_response(&response_text, inputs.len())
}

/// Resolve the full embedding API endpoint URL.
fn resolve_embedding_endpoint(base_url: &str, embedding_type: &str) -> String {
    let normalized = normalize_base_url(base_url);

    if normalized.is_empty() {
        // Default endpoints when base_url is empty
        return match embedding_type {
            "jina" => "https://api.jina.ai/v1/embeddings".to_string(),
            _ => "https://api.openai.com/v1/embeddings".to_string(),
        };
    }

    // If the base URL already ends with /embeddings, use as-is
    if normalized.ends_with("/embeddings") {
        return normalized;
    }

    // If it ends with /v1, append /embeddings
    if normalized.ends_with("/v1") {
        return format!("{normalized}/embeddings");
    }

    // Otherwise, append /v1/embeddings
    format!("{normalized}/v1/embeddings")
}

fn build_headers(config: &EmbeddingConfig) -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(
        "Content-Type",
        HeaderValue::from_static("application/json"),
    );
    headers.insert(
        "Accept",
        HeaderValue::from_static("application/json"),
    );

    if !config.api_key.is_empty() {
        // Jina uses "Bearer" token as well, same as OpenAI
        let auth_value = HeaderValue::from_str(&format!("Bearer {}", config.api_key));
        if let Ok(value) = auth_value {
            headers.insert("Authorization", value);
        }
    }

    headers
}

fn build_request_body(config: &EmbeddingConfig, inputs: &[String]) -> Value {
    let model = if config.model_name.is_empty() {
        match config.embedding_type.as_str() {
            "jina" => "jina-embeddings-v3",
            _ => "text-embedding-3-small",
        }
        .to_string()
    } else {
        config.model_name.clone()
    };

    json!({
        "model": model,
        "input": inputs,
        "dimensions": config.dimensions,
    })
}

/// Parse the OpenAI-compatible embedding response.
///
/// Expected format:
/// ```json
/// {
///   "data": [
///     { "embedding": [0.1, 0.2, ...], "index": 0 },
///     { "embedding": [0.3, 0.4, ...], "index": 1 }
///   ]
/// }
/// ```
fn parse_embedding_response(response_text: &str, expected_count: usize) -> Result<Vec<Vec<f64>>> {
    let response_text = response_text
        .strip_prefix('\u{feff}')
        .unwrap_or(response_text);

    let parsed: Value = serde_json::from_str(response_text).map_err(|error| {
        Error::from_reason(format!(
            "Failed to parse embedding response as JSON: {error}"
        ))
    })?;

    let data = parsed
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            Error::from_reason("Embedding response missing 'data' array")
        })?;

    if data.len() != expected_count {
        return Err(Error::from_reason(format!(
            "Embedding response count mismatch: expected {expected_count}, got {}",
            data.len()
        )));
    }

    // Sort by index to ensure correct ordering
    let mut indexed_embeddings: Vec<(usize, Vec<f64>)> = Vec::with_capacity(data.len());
    for item in data {
        let index = item
            .get("index")
            .and_then(Value::as_u64)
            .map(|i| i as usize)
            .unwrap_or_else(|| indexed_embeddings.len());

        let embedding = item
            .get("embedding")
            .and_then(Value::as_array)
            .ok_or_else(|| {
                Error::from_reason("Embedding response item missing 'embedding' array")
            })?
            .iter()
            .map(|v| {
                v.as_f64().ok_or_else(|| {
                    Error::from_reason("Embedding vector contains non-numeric value")
                })
            })
            .collect::<Result<Vec<f64>>>()?;

        indexed_embeddings.push((index, embedding));
    }

    indexed_embeddings.sort_by_key(|(index, _)| *index);
    Ok(indexed_embeddings.into_iter().map(|(_, emb)| emb).collect())
}

fn truncate_error(text: &str, max_len: usize) -> String {
    if text.len() <= max_len {
        text.to_string()
    } else {
        format!("{}...", &text[..max_len])
    }
}

/// Serialize a vector to JSON string for storage.
pub fn vector_to_json(vector: &[f64]) -> String {
    serde_json::to_string(vector).unwrap_or_else(|_| "[]".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_endpoint() {
        assert_eq!(
            resolve_embedding_endpoint("", "openai"),
            "https://api.openai.com/v1/embeddings"
        );
        assert_eq!(
            resolve_embedding_endpoint("", "jina"),
            "https://api.jina.ai/v1/embeddings"
        );
        assert_eq!(
            resolve_embedding_endpoint("https://api.example.com", "openai"),
            "https://api.example.com/v1/embeddings"
        );
        assert_eq!(
            resolve_embedding_endpoint("https://api.example.com/v1", "openai"),
            "https://api.example.com/v1/embeddings"
        );
        assert_eq!(
            resolve_embedding_endpoint("https://api.example.com/v1/embeddings", "openai"),
            "https://api.example.com/v1/embeddings"
        );
    }

    #[test]
    fn test_vector_json_roundtrip() {
        let v = vec![1.0, 2.5, -3.0];
        let json = vector_to_json(&v);
        let parsed: Vec<f64> = serde_json::from_str(&json).unwrap();
        assert_eq!(v, parsed);
    }

    #[test]
    fn test_parse_embedding_response() {
        let response = r#"{
            "data": [
                {"embedding": [0.1, 0.2], "index": 0},
                {"embedding": [0.3, 0.4], "index": 1}
            ]
        }"#;
        let result = parse_embedding_response(response, 2).unwrap();
        assert_eq!(result.len(), 2);
        assert_eq!(result[0], vec![0.1, 0.2]);
        assert_eq!(result[1], vec![0.3, 0.4]);
    }
}
