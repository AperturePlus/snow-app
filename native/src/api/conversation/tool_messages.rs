use std::collections::HashSet;

use serde_json::Value;

use crate::storage::services::chat_conversations::ChatContextMessage;

/// Convert stored tool_calls_json (any provider format) into Anthropic
/// tool_use content blocks.
///
/// The storage layer persists whichever native format the originating
/// provider returned, so this function must accept all of them:
/// - **OpenAI Chat**: `{"id":"...","type":"function","function":{"name":"...","arguments":"..."}}`
/// - **OpenAI Responses**: `{"type":"function_call","call_id":"...","name":"...","arguments":"..."}`
/// - **Anthropic**: `{"type":"tool_use","id":"...","name":"...","input":{...}}`
/// - **Gemini**: `{"functionCall":{"name":"...","args":{...}}}`
pub fn tool_calls_as_anthropic_blocks(tool_calls_json: &str) -> Vec<Value> {
    normalize_tool_calls(tool_calls_json)
        .into_iter()
        .map(|entry| {
            serde_json::json!({
                "type": "tool_use",
                "id": entry.id,
                "name": entry.name,
                "input": entry.input,
            })
        })
        .collect()
}

/// Convert stored tool_calls_json (any provider format) into Gemini
/// functionCall parts.
pub fn tool_calls_as_gemini_parts(tool_calls_json: &str) -> Vec<Value> {
    normalize_tool_calls(tool_calls_json)
        .into_iter()
        .map(|entry| {
            serde_json::json!({
                "functionCall": {
                    "name": entry.name,
                    "args": entry.input,
                }
            })
        })
        .collect()
}

/// Parse tool_results_json into (name, callId, result) tuples.
pub fn parse_tool_results_json(raw: &str) -> Vec<(String, String, String)> {
    serde_json::from_str::<Vec<Value>>(raw)
        .unwrap_or_default()
        .into_iter()
        .map(|v| {
            let name = v.get("name").and_then(|x| x.as_str()).unwrap_or("").to_string();
            let call_id = v.get("callId").and_then(|x| x.as_str()).unwrap_or("").to_string();
            let result = v.get("result").and_then(|x| x.as_str()).unwrap_or("").to_string();
            (name, call_id, result)
        })
        .collect()
}

/// A provider-agnostic representation of a single tool call extracted from
/// the stored `tool_calls_json`. All conversion functions go through this
/// intermediate type so they automatically support every provider format.
struct NormalizedToolCall {
    id: String,
    name: String,
    input: Value,
}

/// Normalize a serialized tool_calls JSON array into [`NormalizedToolCall`]
/// entries, accepting any provider's native format:
/// - **OpenAI Chat**: `{"id":"...","type":"function","function":{"name":"...","arguments":"..."}}`
/// - **OpenAI Responses**: `{"type":"function_call","call_id":"...","name":"...","arguments":"..."}`
/// - **Anthropic**: `{"type":"tool_use","id":"...","name":"...","input":{...}}`
/// - **Gemini**: `{"functionCall":{"name":"...","args":{...}}}`
fn normalize_tool_calls(tool_calls_json: &str) -> Vec<NormalizedToolCall> {
    let Ok(parsed) = serde_json::from_str::<Value>(tool_calls_json) else {
        return Vec::new();
    };
    let Some(array) = parsed.as_array() else {
        return Vec::new();
    };

    array
        .iter()
        .filter_map(|call| {
            // --- id ---
            // OpenAI Chat / Anthropic use "id"; OpenAI Responses uses "call_id".
            let id = call
                .get("id")
                .and_then(Value::as_str)
                .or_else(|| call.get("call_id").and_then(Value::as_str))?
                .to_string();
            if id.is_empty() {
                return None;
            }

            // --- name ---
            // OpenAI Chat nests under "function.name"; the other providers
            // use a top-level "name". Gemini nests under
            // "functionCall.name".
            let name = call
                .get("name")
                .and_then(Value::as_str)
                .or_else(|| {
                    call.get("function")
                        .and_then(|f| f.get("name"))
                        .and_then(Value::as_str)
                })
                .or_else(|| {
                    call.get("functionCall")
                        .and_then(|f| f.get("name"))
                        .and_then(Value::as_str)
                })
                .unwrap_or("unknown_tool")
                .to_string();

            // --- input ---
            // Anthropic stores an object under "input". OpenAI Chat /
            // Responses store a JSON string under "arguments". Gemini stores
            // an object under "functionCall.args".
            let input = if let Some(input_val) = call.get("input") {
                if input_val.is_object() {
                    input_val.clone()
                } else if let Some(s) = input_val.as_str() {
                    serde_json::from_str(s).unwrap_or_else(|_| serde_json::json!({}))
                } else {
                    serde_json::json!({})
                }
            } else if let Some(arguments) = call.get("arguments") {
                // OpenAI Responses sometimes stores arguments as a parsed
                // object; OpenAI Chat stores them as a JSON string.
                if arguments.is_object() {
                    arguments.clone()
                } else if let Some(s) = arguments.as_str() {
                    serde_json::from_str(s).unwrap_or_else(|_| serde_json::json!({}))
                } else {
                    serde_json::json!({})
                }
            } else if let Some(args) = call
                .get("functionCall")
                .and_then(|f| f.get("args"))
            {
                args.clone()
            } else {
                serde_json::json!({})
            };

            Some(NormalizedToolCall { id, name, input })
        })
        .collect()
}

/// Extract (id, name) entries from a serialized tool_calls JSON array.
/// Supports all provider formats via [`normalize_tool_calls`].
fn extract_tool_call_entries(tool_calls_json: &str) -> Vec<(String, String)> {
    normalize_tool_calls(tool_calls_json)
        .into_iter()
        .map(|entry| (entry.id, entry.name))
        .collect()
}

/// Ensure every tool call has a matching tool result and vice-versa.
///
/// AI APIs reject request bodies containing "orphan" tool entries — a
/// `tool_use`/`tool_calls` without a corresponding `tool_result`, or a
/// `tool_result` referencing a call id that never appeared. This can happen
/// when a conversation is interrupted mid-turn (e.g. the user stops
/// generation after the model emits tool calls but before results arrive) or
/// when history is truncated by context-window management.
///
/// This function scans the message list and patches both directions:
/// - **Orphan calls** (call without result): a synthetic `tool` message with
///   placeholder results is inserted immediately after the assistant message.
/// - **Orphan results** (result without call): a synthetic `assistant` message
///   carrying the missing tool calls is inserted immediately before the tool
///   message.
pub fn ensure_tool_pairing(messages: &mut Vec<ChatContextMessage>) {
    // --- Pass 1: collect all known call ids and result call-ids ---
    let mut all_call_ids: HashSet<String> = HashSet::new();
    let mut all_result_ids: HashSet<String> = HashSet::new();

    for msg in messages.iter() {
        let role = msg.role.trim();
        if role == "assistant" {
            if let Some(ref raw) = msg.tool_calls_json {
                for (id, _name) in extract_tool_call_entries(raw) {
                    all_call_ids.insert(id);
                }
            }
        } else if role == "tool" {
            if let Some(ref raw) = msg.tool_results_json {
                for (_name, call_id, _result) in parse_tool_results_json(raw) {
                    if !call_id.is_empty() {
                        all_result_ids.insert(call_id);
                    }
                }
            }
        }
    }

    // Quick exit when everything is already paired.
    let has_orphan_calls = messages.iter().any(|msg| {
        msg.role.trim() == "assistant"
            && msg
                .tool_calls_json
                .as_deref()
                .map(|raw| {
                    extract_tool_call_entries(raw)
                        .iter()
                        .any(|(id, _)| !all_result_ids.contains(id))
                })
                .unwrap_or(false)
    });
    let has_orphan_results = messages.iter().any(|msg| {
        msg.role.trim() == "tool"
            && msg
                .tool_results_json
                .as_deref()
                .map(|raw| {
                    parse_tool_results_json(raw)
                        .iter()
                        .any(|(_n, cid, _r)| !cid.is_empty() && !all_call_ids.contains(cid))
                })
                .unwrap_or(false)
    });
    if !has_orphan_calls && !has_orphan_results {
        return;
    }

    // --- Pass 2: patch orphans (iterate backwards so insertions don't shift
    //     indices of entries we haven't visited yet) ---
    let mut i = messages.len();
    while i > 0 {
        i -= 1;
        let role = messages[i].role.trim().to_string();

        if role == "assistant" {
            let orphan_entries: Vec<(String, String)> = messages[i]
                .tool_calls_json
                .as_deref()
                .map(|raw| {
                    extract_tool_call_entries(raw)
                        .into_iter()
                        .filter(|(id, _)| !all_result_ids.contains(id))
                        .collect()
                })
                .unwrap_or_default();

            if orphan_entries.is_empty() {
                continue;
            }

            // Build a synthetic tool-result message covering every orphan call.
            let results_json: Vec<Value> = orphan_entries
                .iter()
                .map(|(id, name)| {
                    serde_json::json!({
                        "name": name,
                        "callId": id,
                        "result": "[Tool call was interrupted before completion — no result available]",
                    })
                })
                .collect();
            let summary = orphan_entries
                .iter()
                .map(|(id, name)| format!("{name} ({id})"))
                .collect::<Vec<_>>()
                .join(", ");

            let synthetic_tool_msg = ChatContextMessage {
                role: "tool".to_string(),
                content: format!("[Interrupted tool results: {summary}]"),
                tool_calls_json: None,
                tool_results_json: serde_json::to_string(&results_json).ok(),
                thinking: None,
                thinking_blocks_json: None,
            };

            messages.insert(i + 1, synthetic_tool_msg);
            for (id, _) in &orphan_entries {
                all_result_ids.insert(id.clone());
            }
        } else if role == "tool" {
            let orphan_results: Vec<(String, String)> = messages[i]
                .tool_results_json
                .as_deref()
                .map(|raw| {
                    parse_tool_results_json(raw)
                        .into_iter()
                        .filter(|(_name, call_id, _result)| {
                            !call_id.is_empty() && !all_call_ids.contains(call_id)
                        })
                        .map(|(name, call_id, _result)| (name, call_id))
                        .collect()
                })
                .unwrap_or_default();

            if orphan_results.is_empty() {
                continue;
            }

            // Build a synthetic assistant message carrying the missing calls.
            let calls_json: Vec<Value> = orphan_results
                .iter()
                .map(|(name, call_id)| {
                    let tool_name = if name.is_empty() { "unknown_tool" } else { name.as_str() };
                    serde_json::json!({
                        "id": call_id,
                        "type": "function",
                        "function": {
                            "name": tool_name,
                            "arguments": "{}",
                        },
                    })
                })
                .collect();

            let synthetic_assistant_msg = ChatContextMessage {
                role: "assistant".to_string(),
                content: String::new(),
                tool_calls_json: serde_json::to_string(&calls_json).ok(),
                tool_results_json: None,
                thinking: None,
                thinking_blocks_json: None,
            };

            // Insert before the tool message; the tool message shifts to i+1
            // but we've already processed it, so the backwards walk is safe.
            messages.insert(i, synthetic_assistant_msg);
            for (_name, call_id) in &orphan_results {
                all_call_ids.insert(call_id.clone());
            }
        }
    }
}
