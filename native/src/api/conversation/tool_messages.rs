use std::collections::HashSet;

use serde_json::Value;

use crate::storage::services::chat_conversations::ChatContextMessage;

/// Convert stored OpenAI-format tool_calls_json into Anthropic tool_use content blocks.
pub fn tool_calls_as_anthropic_blocks(tool_calls_json: &str) -> Vec<Value> {
    let Ok(parsed) = serde_json::from_str::<Value>(tool_calls_json) else {
        return Vec::new();
    };
    let Some(array) = parsed.as_array() else {
        return Vec::new();
    };

    array
        .iter()
        .filter_map(|call| {
            let id = call.get("id")?.as_str()?.to_string();
            let function = call.get("function")?;
            let name = function.get("name")?.as_str()?.to_string();
            let arguments_str = function.get("arguments")?.as_str().unwrap_or("{}");
            let input: Value =
                serde_json::from_str(arguments_str).unwrap_or_else(|_| serde_json::json!({}));

            Some(serde_json::json!({
                "type": "tool_use",
                "id": id,
                "name": name,
                "input": input,
            }))
        })
        .collect()
}

/// Convert stored OpenAI-format tool_calls_json into Gemini functionCall parts.
pub fn tool_calls_as_gemini_parts(tool_calls_json: &str) -> Vec<Value> {
    let Ok(parsed) = serde_json::from_str::<Value>(tool_calls_json) else {
        return Vec::new();
    };
    let Some(array) = parsed.as_array() else {
        return Vec::new();
    };

    array
        .iter()
        .filter_map(|call| {
            let function = call.get("function")?;
            let name = function.get("name")?.as_str()?.to_string();
            let arguments_str = function.get("arguments")?.as_str().unwrap_or("{}");
            let args: Value =
                serde_json::from_str(arguments_str).unwrap_or_else(|_| serde_json::json!({}));

            Some(serde_json::json!({
                "functionCall": {
                    "name": name,
                    "args": args,
                }
            }))
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

/// Extract (id, name) entries from a serialized tool_calls JSON array.
/// Supports both the OpenAI Chat nested format
/// (`{"id":"...","function":{"name":"..."}}`) and the Responses flat format
/// (`{"call_id":"...","name":"..."}`).
fn extract_tool_call_entries(tool_calls_json: &str) -> Vec<(String, String)> {
    let Ok(parsed) = serde_json::from_str::<Value>(tool_calls_json) else {
        return Vec::new();
    };
    let Some(array) = parsed.as_array() else {
        return Vec::new();
    };

    array
        .iter()
        .filter_map(|call| {
            let id = call
                .get("id")
                .and_then(Value::as_str)
                .or_else(|| call.get("call_id").and_then(Value::as_str))?
                .to_string();
            if id.is_empty() {
                return None;
            }
            let name = call
                .get("name")
                .and_then(Value::as_str)
                .or_else(|| {
                    call.get("function")
                        .and_then(|f| f.get("name"))
                        .and_then(Value::as_str)
                })
                .unwrap_or("unknown_tool")
                .to_string();
            Some((id, name))
        })
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
