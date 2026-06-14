use std::path::Path;

use napi::bindgen_prelude::*;
use rusqlite::{params, Connection};

use super::super::database;
use super::super::{SystemPromptItemInput, SystemPromptItemRecord};

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
           prompt_id,
           name,
           content,
           is_active,
           sort_order,
           created_at,
           updated_at
         ) VALUES (
           ?1, ?2, ?3, ?4, ?5, datetime('now'), datetime('now')
         )
         ON CONFLICT(prompt_id) DO UPDATE SET
           name = excluded.name,
           content = excluded.content,
           is_active = excluded.is_active,
           sort_order = excluded.sort_order,
           updated_at = datetime('now')",
        params![
            item.prompt_id,
            item.name,
            item.content,
            item.is_active as i32,
            item.sort_order,
        ],
    )?;

    Ok(())
}
