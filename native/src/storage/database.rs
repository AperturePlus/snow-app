use std::path::Path;

use napi::bindgen_prelude::*;
use rusqlite::Connection;

pub fn ensure_database(database_path: &Path) -> Result<()> {
    Connection::open(database_path)
        .and_then(|connection| create_schema(&connection))
        .map_err(|error| database_error(database_path, "initialize", error))
}

fn create_schema(connection: &Connection) -> rusqlite::Result<()> {
    connection.execute_batch(
        "PRAGMA user_version = 2;

         CREATE TABLE IF NOT EXISTS system_settings (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           setting_name TEXT NOT NULL,
           setting_code TEXT NOT NULL UNIQUE,
           setting_value TEXT NOT NULL,
           created_at TEXT NOT NULL DEFAULT (datetime('now')),
           updated_at TEXT NOT NULL DEFAULT (datetime('now'))
         );

         CREATE TABLE IF NOT EXISTS api_configs (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           profile_name TEXT NOT NULL UNIQUE,
           display_name TEXT NOT NULL,
           is_active INTEGER NOT NULL DEFAULT 0,
           base_url TEXT NOT NULL DEFAULT '',
           base_url_mode TEXT NOT NULL DEFAULT 'auto',
           api_key TEXT NOT NULL DEFAULT '',
           request_method TEXT NOT NULL DEFAULT 'chat',
           advanced_model TEXT NOT NULL DEFAULT '',
           basic_model TEXT NOT NULL DEFAULT '',
           supports_vision INTEGER NOT NULL DEFAULT 1,
           vision_base_url TEXT NOT NULL DEFAULT '',
           vision_base_url_mode TEXT NOT NULL DEFAULT 'auto',
           vision_api_key TEXT NOT NULL DEFAULT '',
           vision_request_method TEXT NOT NULL DEFAULT 'chat',
           vision_model TEXT NOT NULL DEFAULT '',
           max_context_tokens INTEGER,
           max_tokens INTEGER,
           stream_idle_timeout_sec INTEGER,
           config_json TEXT NOT NULL DEFAULT '{}',
           source TEXT NOT NULL DEFAULT 'manual',
           created_at TEXT NOT NULL DEFAULT (datetime('now')),
           updated_at TEXT NOT NULL DEFAULT (datetime('now'))
         );

         CREATE INDEX IF NOT EXISTS idx_api_configs_active
           ON api_configs(is_active);
         CREATE INDEX IF NOT EXISTS idx_api_configs_source
           ON api_configs(source);",
    )
}

pub fn database_error(database_path: &Path, action: &str, error: rusqlite::Error) -> Error {
    Error::from_reason(format!(
        "Failed to {action} Snow App sqlite database at '{}': {error}",
        database_path.display()
    ))
}
