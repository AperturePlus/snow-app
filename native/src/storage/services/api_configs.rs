use std::path::Path;

use napi::bindgen_prelude::*;
use rusqlite::{params, Connection, OptionalExtension};

use super::super::database;
use super::super::{ApiConfigInput, ApiConfigRecord};

pub fn list_api_configs(database_path: &Path) -> Result<Vec<ApiConfigRecord>> {
    Connection::open(database_path)
        .and_then(|connection| {
            let mut statement = connection.prepare(
                "SELECT id,
                        profile_name,
                        display_name,
                        is_active,
                        base_url,
                        base_url_mode,
                        api_key,
                        request_method,
                        advanced_model,
                        basic_model,
                        supports_vision,
                        vision_base_url,
                        vision_api_key,
                        vision_request_method,
                        vision_model,
                        max_context_tokens,
                        max_tokens,
                        stream_idle_timeout_sec,
                        source,
                        updated_at
                   FROM api_configs
                  ORDER BY is_active DESC, display_name COLLATE NOCASE ASC",
            )?;

            let rows = statement.query_map([], |row| {
                let is_active: i64 = row.get(3)?;
                let supports_vision: i64 = row.get(10)?;

                Ok(ApiConfigRecord {
                    id: row.get(0)?,
                    profile_name: row.get(1)?,
                    display_name: row.get(2)?,
                    is_active: is_active != 0,
                    base_url: row.get(4)?,
                    base_url_mode: row.get(5)?,
                    api_key: row.get(6)?,
                    request_method: row.get(7)?,
                    advanced_model: row.get(8)?,
                    basic_model: row.get(9)?,
                    supports_vision: supports_vision != 0,
                    vision_base_url: row.get(11)?,
                    vision_api_key: row.get(12)?,
                    vision_request_method: row.get(13)?,
                    vision_model: row.get(14)?,
                    max_context_tokens: row.get(15)?,
                    max_tokens: row.get(16)?,
                    stream_idle_timeout_sec: row.get(17)?,
                    source: row.get(18)?,
                    updated_at: row.get(19)?,
                })
            })?;

            rows.collect()
        })
        .map_err(|error| database::database_error(database_path, "list API configs", error))
}

pub fn upsert_api_config(database_path: &Path, config: &ApiConfigInput) -> Result<()> {
    Connection::open(database_path)
        .and_then(|mut connection| {
            let transaction = connection.transaction()?;

            if config.is_active {
                transaction.execute(
                    "UPDATE api_configs
                        SET is_active = 0,
                            updated_at = datetime('now')
                      WHERE is_active = 1",
                    [],
                )?;
            }

            transaction.execute(
                "INSERT INTO api_configs (
                   profile_name,
                   display_name,
                   is_active,
                   base_url,
                   base_url_mode,
                   api_key,
                   request_method,
                   advanced_model,
                   basic_model,
                   supports_vision,
                   vision_base_url,
                   vision_base_url_mode,
                   vision_api_key,
                   vision_request_method,
                   vision_model,
                   max_context_tokens,
                   max_tokens,
                   stream_idle_timeout_sec,
                   config_json,
                   source,
                   created_at,
                   updated_at
                 ) VALUES (
                   ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                   ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20,
                   datetime('now'), datetime('now')
                 )
                 ON CONFLICT(profile_name) DO UPDATE SET
                   display_name = excluded.display_name,
                   is_active = excluded.is_active,
                   base_url = excluded.base_url,
                   base_url_mode = excluded.base_url_mode,
                   api_key = CASE
                     WHEN excluded.api_key = '' AND api_configs.api_key <> '' THEN api_configs.api_key
                     ELSE excluded.api_key
                   END,
                   request_method = excluded.request_method,
                   advanced_model = excluded.advanced_model,
                   basic_model = excluded.basic_model,
                   supports_vision = excluded.supports_vision,
                   vision_base_url = excluded.vision_base_url,
                   vision_base_url_mode = excluded.vision_base_url_mode,
                   vision_api_key = CASE
                     WHEN excluded.vision_api_key = '' AND api_configs.vision_api_key <> '' THEN api_configs.vision_api_key
                     ELSE excluded.vision_api_key
                   END,
                   vision_request_method = excluded.vision_request_method,
                   vision_model = excluded.vision_model,
                   max_context_tokens = excluded.max_context_tokens,
                   max_tokens = excluded.max_tokens,
                   stream_idle_timeout_sec = excluded.stream_idle_timeout_sec,
                   config_json = excluded.config_json,
                   source = excluded.source,
                   updated_at = datetime('now')",
                params![
                    config.profile_name,
                    config.display_name,
                    config.is_active as i32,
                    config.base_url,
                    config.base_url_mode,
                    config.api_key,
                    config.request_method,
                    config.advanced_model,
                    config.basic_model,
                    config.supports_vision as i32,
                    config.vision_base_url,
                    config.vision_base_url_mode,
                    config.vision_api_key,
                    config.vision_request_method,
                    config.vision_model,
                    config.max_context_tokens,
                    config.max_tokens,
                    config.stream_idle_timeout_sec,
                    config.config_json,
                    config.source,
                ],
            )?;

            transaction.commit()
        })
        .map_err(|error| database::database_error(database_path, "upsert API config", error))
}

pub fn delete_api_config(database_path: &Path, profile_name: &str) -> Result<()> {
    Connection::open(database_path)
        .and_then(|mut connection| {
            let transaction = connection.transaction()?;
            let deleted_config_was_active = transaction
                .query_row(
                    "SELECT is_active FROM api_configs WHERE profile_name = ?1",
                    [profile_name],
                    |row| row.get::<_, i64>(0),
                )
                .optional()?
                .unwrap_or(0)
                != 0;

            transaction.execute(
                "DELETE FROM api_configs WHERE profile_name = ?1",
                [profile_name],
            )?;

            if deleted_config_was_active {
                let active_config_id = transaction
                    .query_row(
                        "SELECT id FROM api_configs WHERE is_active = 1 LIMIT 1",
                        [],
                        |row| row.get::<_, i32>(0),
                    )
                    .optional()?;

                if active_config_id.is_none() {
                    transaction.execute(
                        "UPDATE api_configs
                            SET is_active = 1,
                                updated_at = datetime('now')
                          WHERE id = (
                            SELECT id
                              FROM api_configs
                             ORDER BY updated_at DESC, display_name COLLATE NOCASE ASC
                             LIMIT 1
                          )",
                        [],
                    )?;
                }
            }

            transaction.commit()
        })
        .map_err(|error| database::database_error(database_path, "delete API config", error))
}
