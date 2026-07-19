use std::path::Path;

use napi::bindgen_prelude::*;
use rusqlite::{params, Connection};
use serde_json::Value;

use super::super::database;
use super::super::{SystemPromptItemInput, SystemPromptItemRecord};

/// Sentinel value that explicitly disables user system prompts for a profile,
/// overriding the global active list. Matches the frontend convention used in
/// `SystemPromptSelect` (`__DISABLED__`).
const DISABLED_SENTINEL: &str = "__DISABLED__";

pub fn list_system_prompts(database_path: &Path) -> Result<Vec<SystemPromptItemRecord>> {
    Connection::open(database_path)
        .and_then(|connection| query_system_prompts(&connection))
        .map_err(|error| database::database_error(database_path, "list system prompts", error))
}

pub fn upsert_system_prompt(
    database_path: &Path,
    item: &SystemPromptItemInput,
) -> Result<()> {
    Connection::open(database_path)
        .and_then(|connection| upsert_system_prompt_with_connection(&connection, item))
        .map_err(|error| database::database_error(database_path, "upsert system prompt", error))
}

pub fn delete_system_prompt(database_path: &Path, prompt_id: &str) -> Result<()> {
    Connection::open(database_path)
        .and_then(|connection| {
            connection.execute(
                "DELETE FROM system_prompts WHERE prompt_id = ?1",
                [prompt_id],
            )?;
            Ok(())
        })
        .map_err(|error| database::database_error(database_path, "delete system prompt", error))
}

fn query_system_prompts(
    connection: &Connection,
) -> rusqlite::Result<Vec<SystemPromptItemRecord>> {
    let mut statement = connection.prepare(
        "SELECT id,
                prompt_id,
                name,
                content,
                is_active,
                sort_order,
                updated_at
           FROM system_prompts
          ORDER BY sort_order ASC, id ASC",
    )?;

    let rows = statement.query_map([], |row| {
        let is_active: i64 = row.get(4)?;

        Ok(SystemPromptItemRecord {
            id: row.get(0)?,
            prompt_id: row.get(1)?,
            name: row.get(2)?,
            content: row.get(3)?,
            is_active: is_active != 0,
            sort_order: row.get(5)?,
            updated_at: row.get(6)?,
        })
    })?;

    rows.collect()
}

fn upsert_system_prompt_with_connection(
    connection: &Connection,
    item: &SystemPromptItemInput,
) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO system_prompts (
           id,
           prompt_id,
           name,
           content,
           is_active,
           sort_order,
           created_at,
           updated_at
         ) VALUES (
           ?1, ?2, ?3, ?4, ?5, ?6, datetime('now'), datetime('now')
         )
         ON CONFLICT(prompt_id) DO UPDATE SET
           name = excluded.name,
           content = excluded.content,
           is_active = excluded.is_active,
           sort_order = excluded.sort_order,
           updated_at = datetime('now')",
        params![
            database::create_snowflake_id(),
            item.prompt_id,
            item.name,
            item.content,
            item.is_active as i32,
            item.sort_order,
        ],
    )?;

    Ok(())
}

/// Resolve the user-configured system prompt contents for a given API profile.
///
/// Mirrors Snow CLI's `getCustomSystemPromptForConfig`:
/// - `system_prompt_ids_json` empty → follow the global active list (prompts
///   with `is_active = true`, ordered by `sort_order`).
/// - `system_prompt_ids_json` equal to `__DISABLED__` or an empty JSON array
///   → return an empty vector (profile explicitly opts out).
/// - Otherwise parse the JSON as an array of prompt IDs and return the
///   matching prompt contents in the declared order.
///
/// Returns an empty vector when the database is unreadable or no prompts
/// match, so callers can treat "no user system prompts" uniformly.
pub fn resolve_active_system_prompt_contents(
    database_path: &Path,
    system_prompt_ids_json: &str,
) -> Vec<String> {
    let trimmed = system_prompt_ids_json.trim();
    if trimmed.is_empty() {
        return query_global_active_contents(database_path);
    }

    if trimmed == DISABLED_SENTINEL {
        return Vec::new();
    }

    let ids = match parse_prompt_id_array(trimmed) {
        Some(ids) if !ids.is_empty() => ids,
        _ => return Vec::new(),
    };

    let prompts = match list_system_prompts(database_path) {
        Ok(prompts) => prompts,
        Err(_) => return Vec::new(),
    };

    let mut contents = Vec::new();
    for id in ids {
        if let Some(prompt) = prompts.iter().find(|item| item.prompt_id == id) {
            let content = prompt.content.trim();
            if !content.is_empty() {
                contents.push(content.to_string());
            }
        }
    }
    contents
}

fn query_global_active_contents(database_path: &Path) -> Vec<String> {
    let prompts = match list_system_prompts(database_path) {
        Ok(prompts) => prompts,
        Err(_) => return Vec::new(),
    };

    prompts
        .into_iter()
        .filter(|prompt| prompt.is_active)
        .map(|prompt| prompt.content.trim().to_string())
        .filter(|content| !content.is_empty())
        .collect()
}

/// Parse a JSON string into a list of prompt IDs.
///
/// Accepts both `["id1", "id2"]` arrays and a bare string `"id1"` for
/// backward compatibility with single-select profiles.
fn parse_prompt_id_array(raw: &str) -> Option<Vec<String>> {
    let value: Value = serde_json::from_str(raw).ok()?;

    match value {
        Value::Array(items) => {
            let ids = items
                .into_iter()
                .filter_map(|item| item.as_str().map(|s| s.to_string()))
                .collect::<Vec<_>>();
            Some(ids)
        }
        Value::String(id) => Some(vec![id]),
        _ => None,
    }
}
