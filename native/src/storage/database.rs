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
        "PRAGMA user_version = 6;

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
           ON codebase_settings(source);

         CREATE TABLE IF NOT EXISTS system_prompts (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           prompt_id TEXT NOT NULL UNIQUE,
           name TEXT NOT NULL DEFAULT '',
           content TEXT NOT NULL DEFAULT '',
           is_active INTEGER NOT NULL DEFAULT 0,
           sort_order INTEGER NOT NULL DEFAULT 0,
           created_at TEXT NOT NULL DEFAULT (datetime('now')),
           updated_at TEXT NOT NULL DEFAULT (datetime('now'))
         );
         CREATE INDEX IF NOT EXISTS idx_system_prompts_active
           ON system_prompts(is_active);

         CREATE TABLE IF NOT EXISTS custom_header_schemes (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           scheme_id TEXT NOT NULL UNIQUE,
           name TEXT NOT NULL DEFAULT '',
           headers_json TEXT NOT NULL DEFAULT '{}',
           is_active INTEGER NOT NULL DEFAULT 0,
           sort_order INTEGER NOT NULL DEFAULT 0,
           created_at TEXT NOT NULL DEFAULT (datetime('now')),
           updated_at TEXT NOT NULL DEFAULT (datetime('now'))
         );
         CREATE INDEX IF NOT EXISTS idx_custom_header_schemes_active
           ON custom_header_schemes(is_active);

         CREATE TABLE IF NOT EXISTS mcp_server_configs (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           server_id TEXT NOT NULL UNIQUE,
           scope TEXT NOT NULL DEFAULT 'global',
           name TEXT NOT NULL DEFAULT '',
           transport_type TEXT NOT NULL DEFAULT 'stdio',
           url TEXT NOT NULL DEFAULT '',
           command TEXT NOT NULL DEFAULT '',
           args_json TEXT NOT NULL DEFAULT '[]',
           env_json TEXT NOT NULL DEFAULT '{}',
           headers_json TEXT NOT NULL DEFAULT '{}',
           enabled INTEGER NOT NULL DEFAULT 1,
           timeout_ms INTEGER,
           sort_order INTEGER NOT NULL DEFAULT 0,
           source TEXT NOT NULL DEFAULT 'manual',
           created_at TEXT NOT NULL DEFAULT (datetime('now')),
           updated_at TEXT NOT NULL DEFAULT (datetime('now'))
         );
         CREATE INDEX IF NOT EXISTS idx_mcp_server_configs_scope
           ON mcp_server_configs(scope);
         CREATE INDEX IF NOT EXISTS idx_mcp_server_configs_enabled
           ON mcp_server_configs(enabled);
         CREATE INDEX IF NOT EXISTS idx_mcp_server_configs_source
           ON mcp_server_configs(source);

         CREATE TABLE IF NOT EXISTS sensitive_command_configs (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           command_id TEXT NOT NULL,
           scope TEXT NOT NULL DEFAULT 'global',
           pattern TEXT NOT NULL,
           description TEXT NOT NULL DEFAULT '',
           enabled INTEGER NOT NULL DEFAULT 1,
           is_preset INTEGER NOT NULL DEFAULT 0,
           sort_order INTEGER NOT NULL DEFAULT 0,
           source TEXT NOT NULL DEFAULT 'manual',
           created_at TEXT NOT NULL DEFAULT (datetime('now')),
           updated_at TEXT NOT NULL DEFAULT (datetime('now')),
           UNIQUE(scope, command_id)
         );
         CREATE INDEX IF NOT EXISTS idx_sensitive_command_configs_scope
           ON sensitive_command_configs(scope);
         CREATE INDEX IF NOT EXISTS idx_sensitive_command_configs_enabled
           ON sensitive_command_configs(enabled);
         CREATE INDEX IF NOT EXISTS idx_sensitive_command_configs_source
           ON sensitive_command_configs(source);
    ",
    )
}

pub fn database_error(database_path: &Path, action: &str, error: rusqlite::Error) -> Error {
    Error::from_reason(format!(
        "Failed to {action} Snow App sqlite database at '{}': {error}",
        database_path.display()
    ))
}
