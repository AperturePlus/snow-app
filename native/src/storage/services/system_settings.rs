use std::path::Path;

use napi::bindgen_prelude::*;
use rusqlite::{Connection, OptionalExtension};

use super::super::database;

const DEFAULT_LANGUAGE_SETTING_NAME: &str = "Language";
const DEFAULT_LANGUAGE_SETTING_CODE: &str = "language";
const DEFAULT_LANGUAGE_SETTING_VALUE: &str = "en";

const DEFAULT_PROXY_BROWSER_SETTING_NAME: &str = "Proxy and browser settings";
const DEFAULT_PROXY_BROWSER_SETTING_CODE: &str = "proxy_browser_settings";
const DEFAULT_PROXY_BROWSER_SETTING_VALUE: &str = "{\"enabled\":false,\"port\":7890,\"browserPath\":\"\",\"browserDebugPort\":9222,\"searchEngine\":\"duckduckgo\"}";

const DEFAULT_TERMINAL_SETTING_NAME: &str = "Terminal settings";
const DEFAULT_TERMINAL_SETTING_CODE: &str = "terminal_settings";
const DEFAULT_TERMINAL_SETTING_VALUE: &str = "{\"shellPath\":\"\",\"fontFamily\":\"\",\"fontSize\":14,\"fontWeight\":\"normal\",\"lineHeight\":1.2,\"proxy\":\"\"}";

const DEFAULT_CODEBASE_SETTING_NAME: &str = "Codebase settings";
const DEFAULT_CODEBASE_SETTING_CODE: &str = "codebase_settings";
const DEFAULT_CODEBASE_SETTING_VALUE: &str = "{\"profileName\":\"default\",\"enabled\":false,\"enableAgentReview\":true,\"enableReranking\":false,\"embeddingType\":\"jina\",\"embeddingModelName\":\"\",\"embeddingBaseUrl\":\"\",\"embeddingApiKey\":\"\",\"embeddingDimensions\":1536,\"batchMaxLines\":10,\"batchConcurrency\":3,\"chunkingMaxLinesPerChunk\":200,\"chunkingMinLinesPerChunk\":10,\"chunkingMinCharsPerChunk\":20,\"chunkingOverlapLines\":20,\"rerankingModelName\":\"\",\"rerankingBaseUrl\":\"\",\"rerankingApiKey\":\"\",\"rerankingContextLength\":4096,\"rerankingTopN\":5,\"configJson\":\"{}\",\"source\":\"manual\"}";

pub fn seed_default_settings(database_path: &Path) -> Result<()> {
    Connection::open(database_path)
        .and_then(|connection| seed_default_settings_with_connection(&connection))
        .map_err(|error| database::database_error(database_path, "seed default settings", error))
}

pub fn get_system_setting_value(
    database_path: &Path,
    setting_code: &str,
) -> Result<Option<String>> {
    Connection::open(database_path)
        .and_then(|connection| {
            connection
                .query_row(
                    "SELECT setting_value FROM system_settings WHERE setting_code = ?1",
                    [setting_code],
                    |row| row.get(0),
                )
                .optional()
        })
        .map_err(|error| database::database_error(database_path, "read system setting", error))
}

pub fn set_system_setting(
    database_path: &Path,
    setting_name: &str,
    setting_code: &str,
    setting_value: &str,
) -> Result<()> {
    Connection::open(database_path)
        .and_then(|connection| {
            connection.execute(
                "INSERT INTO system_settings (id, setting_name, setting_code, setting_value, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, datetime('now'), datetime('now'))
                 ON CONFLICT(setting_code) DO UPDATE SET
                   setting_name = excluded.setting_name,
                   setting_value = excluded.setting_value,
                   updated_at = datetime('now')",
                (
                    database::create_snowflake_id(),
                    setting_name,
                    setting_code,
                    setting_value,
                ),
            )?;

            Ok(())
        })
        .map_err(|error| database::database_error(database_path, "write system setting", error))
}

fn insert_default_setting(
    connection: &Connection,
    setting_name: &str,
    setting_code: &str,
    setting_value: &str,
) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT OR IGNORE INTO system_settings (id, setting_name, setting_code, setting_value, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, datetime('now'), datetime('now'))",
        (
            database::create_snowflake_id(),
            setting_name,
            setting_code,
            setting_value,
        ),
    )?;

    Ok(())
}

fn seed_default_settings_with_connection(connection: &Connection) -> rusqlite::Result<()> {
    insert_default_setting(
        connection,
        DEFAULT_LANGUAGE_SETTING_NAME,
        DEFAULT_LANGUAGE_SETTING_CODE,
        DEFAULT_LANGUAGE_SETTING_VALUE,
    )?;
    insert_default_setting(
        connection,
        DEFAULT_PROXY_BROWSER_SETTING_NAME,
        DEFAULT_PROXY_BROWSER_SETTING_CODE,
        DEFAULT_PROXY_BROWSER_SETTING_VALUE,
    )?;
    insert_default_setting(
        connection,
        DEFAULT_TERMINAL_SETTING_NAME,
        DEFAULT_TERMINAL_SETTING_CODE,
        DEFAULT_TERMINAL_SETTING_VALUE,
    )?;
    insert_default_setting(
        connection,
        DEFAULT_CODEBASE_SETTING_NAME,
        DEFAULT_CODEBASE_SETTING_CODE,
        DEFAULT_CODEBASE_SETTING_VALUE,
    )?;

    Ok(())
}
