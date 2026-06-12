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
        "PRAGMA user_version = 3;

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

         CREATE TABLE IF NOT EXISTS codebase_settings (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           profile_name TEXT NOT NULL UNIQUE,
           enabled INTEGER NOT NULL DEFAULT 0,
           enable_agent_review INTEGER NOT NULL DEFAULT 1,
           enable_reranking INTEGER NOT NULL DEFAULT 0,
           embedding_type TEXT NOT NULL DEFAULT 'jina',
           embedding_model_name TEXT NOT NULL DEFAULT '',
           embedding_base_url TEXT NOT NULL DEFAULT '',
           embedding_api_key TEXT NOT NULL DEFAULT '',
           embedding_dimensions INTEGER NOT NULL DEFAULT 1536,
           batch_max_lines INTEGER NOT NULL DEFAULT 10,
           batch_concurrency INTEGER NOT NULL DEFAULT 3,
           chunking_max_lines_per_chunk INTEGER NOT NULL DEFAULT 200,
           chunking_min_lines_per_chunk INTEGER NOT NULL DEFAULT 10,
           chunking_min_chars_per_chunk INTEGER NOT NULL DEFAULT 20,
           chunking_overlap_lines INTEGER NOT NULL DEFAULT 20,
           reranking_model_name TEXT NOT NULL DEFAULT '',
           reranking_base_url TEXT NOT NULL DEFAULT '',
           reranking_api_key TEXT NOT NULL DEFAULT '',
           reranking_context_length INTEGER NOT NULL DEFAULT 4096,
           reranking_top_n INTEGER NOT NULL DEFAULT 5,
           config_json TEXT NOT NULL DEFAULT '{}',
           source TEXT NOT NULL DEFAULT 'manual',
           created_at TEXT NOT NULL DEFAULT (datetime('now')),
           updated_at TEXT NOT NULL DEFAULT (datetime('now'))
         );

         CREATE INDEX IF NOT EXISTS idx_api_configs_active
           ON api_configs(is_active);
         CREATE INDEX IF NOT EXISTS idx_api_configs_source
           ON api_configs(source);
         CREATE INDEX IF NOT EXISTS idx_codebase_settings_source
           ON codebase_settings(source);",
    )
}

pub fn database_error(database_path: &Path, action: &str, error: rusqlite::Error) -> Error {
    Error::from_reason(format!(
        "Failed to {action} Snow App sqlite database at '{}': {error}",
        database_path.display()
    ))
}
