use std::path::Path;

use napi::bindgen_prelude::*;
use rusqlite::{params, Connection};

use super::super::database;
use super::super::{ApiConfigInput, ApiConfigRecord};

const DEFAULT_PROFILE_NAME: &str = "default";
const DEFAULT_DISPLAY_NAME: &str = "Default API";
const DEFAULT_BASE_URL: &str = "https://api.openai.com/v1";
const DEFAULT_REQUEST_METHOD: &str = "chat";
const DEFAULT_ADVANCED_MODEL: &str = "gpt-4.1";
const DEFAULT_BASIC_MODEL: &str = "gpt-4.1-mini";
const DEFAULT_CONFIG_JSON: &str = "{\"snowcfg\":{\"baseUrl\":\"https://api.openai.com/v1\",\"baseUrlMode\":\"auto\",\"requestMethod\":\"chat\",\"advancedModel\":\"gpt-4.1\",\"basicModel\":\"gpt-4.1-mini\",\"supportsVision\":true}}";

pub fn seed_default_api_config(database_path: &Path) -> Result<()> {
    Connection::open(database_path)
        .and_then(|connection| seed_default_api_config_with_connection(&connection))
        .map_err(|error| database::database_error(database_path, "seed default API config", error))
}

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
                        enable_auto_compress,
                        auto_compress_threshold,
                        source,
                        updated_at
                   FROM api_configs
                  ORDER BY is_active DESC, display_name COLLATE NOCASE ASC",
            )?;

            let rows = statement.query_map([], |row| {
                let is_active: i64 = row.get(3)?;
                let supports_vision: i64 = row.get(10)?;
                let enable_auto_compress: i64 = row.get(18)?;

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
                    enable_auto_compress: enable_auto_compress != 0,
                    auto_compress_threshold: row.get(19)?,
                    source: row.get(20)?,
                    updated_at: row.get(21)?,
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
                   enable_auto_compress,
                   auto_compress_threshold,
                   config_json,
                   source,
                   created_at,
                   updated_at
                 ) VALUES (
                   ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                   ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20,
                   ?21, ?22,
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
                   enable_auto_compress = excluded.enable_auto_compress,
                   auto_compress_threshold = excluded.auto_compress_threshold,
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
                    config.enable_auto_compress as i32,
                    config.auto_compress_threshold,
                    config.config_json,
                    config.source,
                ],
            )?;

            if !config.is_active {
                ensure_one_active_config(&transaction)?;
            }

            transaction.commit()
        })
        .map_err(|error| database::database_error(database_path, "upsert API config", error))
}

pub fn delete_api_config(database_path: &Path, profile_name: &str) -> Result<()> {
    Connection::open(database_path)
        .and_then(|mut connection| {
            let transaction = connection.transaction()?;

            transaction.execute(
                "DELETE FROM api_configs WHERE profile_name = ?1",
                [profile_name],
            )?;

            seed_default_api_config_with_connection(&transaction)?;
            ensure_one_active_config(&transaction)?;

            transaction.commit()
        })
        .map_err(|error| database::database_error(database_path, "delete API config", error))
}

fn seed_default_api_config_with_connection(connection: &Connection) -> rusqlite::Result<()> {
    connection.execute(
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
           config_json,
           source,
           created_at,
           updated_at
         )
         SELECT
           ?1, ?2, 1, ?3, 'auto', '', ?4, ?5, ?6, 1,
           '', 'auto', '', ?4, '', ?7, 'default', datetime('now'), datetime('now')
         WHERE NOT EXISTS (SELECT 1 FROM api_configs)",
        params![
            DEFAULT_PROFILE_NAME,
            DEFAULT_DISPLAY_NAME,
            DEFAULT_BASE_URL,
            DEFAULT_REQUEST_METHOD,
            DEFAULT_ADVANCED_MODEL,
            DEFAULT_BASIC_MODEL,
            DEFAULT_CONFIG_JSON,
        ],
    )?;

    ensure_one_active_config(connection)
}

fn ensure_one_active_config(connection: &Connection) -> rusqlite::Result<()> {
    connection.execute(
        "UPDATE api_configs
            SET is_active = 1,
                updated_at = datetime('now')
          WHERE id = (
            SELECT id
              FROM api_configs
             ORDER BY updated_at DESC, display_name COLLATE NOCASE ASC
             LIMIT 1
          )
            AND NOT EXISTS (
              SELECT 1
                FROM api_configs
               WHERE is_active = 1
            )",
        [],
    )?;

    Ok(())
}
