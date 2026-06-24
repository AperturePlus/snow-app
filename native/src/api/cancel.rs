use std::collections::HashMap;
use std::sync::Mutex;

use napi::bindgen_prelude::*;
use tokio_util::sync::CancellationToken;

static CANCEL_REGISTRY: Mutex<Option<HashMap<String, CancellationToken>>> = Mutex::new(None);

fn with_registry<F, R>(f: F) -> R
where
    F: FnOnce(&mut HashMap<String, CancellationToken>) -> R,
{
    let mut guard = CANCEL_REGISTRY
        .lock()
        .expect("Cancel registry mutex poisoned");
    let registry = guard.get_or_insert_with(HashMap::new);
    f(registry)
}

/// Register a cancellation token for the given stream id.
/// If a token already exists for the same id it is replaced.
pub fn register_stream(stream_id: &str, token: CancellationToken) {
    with_registry(|registry| {
        registry.insert(stream_id.to_string(), token);
    });
}

/// Trigger cancellation for the given stream id and remove the token from the registry.
/// Returns `true` if a token was found and cancelled, `false` otherwise.
pub fn cancel_stream(stream_id: &str) -> bool {
    with_registry(|registry| {
        if let Some(token) = registry.remove(stream_id) {
            token.cancel();
            true
        } else {
            false
        }
    })
}

/// Remove the token from the registry without cancelling it.
/// Called when the stream finishes normally.
pub fn unregister_stream(stream_id: &str) {
    with_registry(|registry| {
        registry.remove(stream_id);
    });
}

/// Get a clone of the token for the given stream id, if it exists.
pub fn get_token(stream_id: &str) -> Option<CancellationToken> {
    with_registry(|registry| registry.get(stream_id).cloned())
}

/// Validate that a stream id is a non-empty trimmed string.
pub fn validate_stream_id(stream_id: &str) -> Result<String> {
    let trimmed = stream_id.trim();
    if trimmed.is_empty() {
        return Err(napi::Error::from_reason("Stream ID is required"));
    }
    Ok(trimmed.to_string())
}

/// Convenience function to create and register a new token for a stream.
pub fn create_and_register(stream_id: &str) -> CancellationToken {
    let token = CancellationToken::new();
    register_stream(stream_id, token.clone());
    token
}


