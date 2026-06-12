use std::path::Path;

use napi::bindgen_prelude::*;
use rusqlite::{params, Connection};

use super::super::database;
use super::super::{CodebaseSettingsInput, CodebaseSettingsRecord};

const DEFAULT_PROFILE_NAME: &str = "default";

pub fn get_codebase_settings(database_path: &Path) -> Result<CodebaseSettingsRecord> {
    Connection::open(database_path)
        .and_then(|connection| {
            seed_default_codebase_settings(&connection)?;
            query_codebase_settings(&connection)
        })
        .map_err(|error| database::database_error(database_path, "read codebase settings", error))
}

pub fn upsert_codebase_settings(
    database_path: &Path,
    settings: &CodebaseSettingsInput,
) -> Result<()> {
    Connection::open(database_path)
        .and_then(|connection| upsert_codebase_settings_with_connection(&connection, settings))
        .map_err(|error| database::database_error(database_path, "write codebase settings", error))
}

fn seed_default_codebase_settings(connection: &Connection) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT OR IGNORE INTO codebase_settings (
           profile_name,
           enabled,
           enable_agent_review,
           enable_reranking,
           embedding_type,
           embedding_model_name,
           embedding_base_url,
           embedding_api_key,
           embedding_dimensions,
           batch_max_lines,
           batch_concurrency,
           chunking_max_lines_per_chunk,
           chunking_min_lines_per_chunk,
           chunking_min_chars_per_chunk,
           chunking_overlap_lines,
           reranking_model_name,
           reranking_base_url,
           reranking_api_key,
           reranking_context_length,
           reranking_top_n,
           config_json,
           source,
           created_at,
           updated_at
         ) VALUES (
           ?1, 0, 1, 0, 'jina', '', '', '', 1536, 10, 3, 200, 10, 20, 20,
           '', '', '', 4096, 5, '{}', 'default', datetime('now'), datetime('now')
         )",
        [DEFAULT_PROFILE_NAME],
    )?;

    Ok(())
}

fn query_codebase_settings(connection: &Connection) -> rusqlite::Result<CodebaseSettingsRecord> {
    connection.query_row(
        "SELECT id,
                profile_name,
                enabled,
                enable_agent_review,
                enable_reranking,
                embedding_type,
                embedding_model_name,
                embedding_base_url,
                embedding_api_key,
                embedding_dimensions,
                batch_max_lines,
                batch_concurrency,
                chunking_max_lines_per_chunk,
                chunking_min_lines_per_chunk,
                chunking_min_chars_per_chunk,
                chunking_overlap_lines,
                reranking_model_name,
                reranking_base_url,
                reranking_api_key,
                reranking_context_length,
                reranking_top_n,
                config_json,
                source,
                updated_at
           FROM codebase_settings
          WHERE profile_name = ?1",
        [DEFAULT_PROFILE_NAME],
        |row| {
            let enabled: i64 = row.get(2)?;
            let enable_agent_review: i64 = row.get(3)?;
            let enable_reranking: i64 = row.get(4)?;

            Ok(CodebaseSettingsRecord {
                id: row.get(0)?,
                profile_name: row.get(1)?,
                enabled: enabled != 0,
                enable_agent_review: enable_agent_review != 0,
                enable_reranking: enable_reranking != 0,
                embedding_type: row.get(5)?,
                embedding_model_name: row.get(6)?,
                embedding_base_url: row.get(7)?,
                embedding_api_key: row.get(8)?,
                embedding_dimensions: row.get(9)?,
                batch_max_lines: row.get(10)?,
                batch_concurrency: row.get(11)?,
                chunking_max_lines_per_chunk: row.get(12)?,
                chunking_min_lines_per_chunk: row.get(13)?,
                chunking_min_chars_per_chunk: row.get(14)?,
                chunking_overlap_lines: row.get(15)?,
                reranking_model_name: row.get(16)?,
                reranking_base_url: row.get(17)?,
                reranking_api_key: row.get(18)?,
                reranking_context_length: row.get(19)?,
                reranking_top_n: row.get(20)?,
                config_json: row.get(21)?,
                source: row.get(22)?,
                updated_at: row.get(23)?,
            })
        },
    )
}

fn upsert_codebase_settings_with_connection(
    connection: &Connection,
    settings: &CodebaseSettingsInput,
) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO codebase_settings (
           profile_name,
           enabled,
           enable_agent_review,
           enable_reranking,
           embedding_type,
           embedding_model_name,
           embedding_base_url,
           embedding_api_key,
           embedding_dimensions,
           batch_max_lines,
           batch_concurrency,
           chunking_max_lines_per_chunk,
           chunking_min_lines_per_chunk,
           chunking_min_chars_per_chunk,
           chunking_overlap_lines,
           reranking_model_name,
           reranking_base_url,
           reranking_api_key,
           reranking_context_length,
           reranking_top_n,
           config_json,
           source,
           created_at,
           updated_at
         ) VALUES (
           ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
           ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22,
           datetime('now'), datetime('now')
         )
         ON CONFLICT(profile_name) DO UPDATE SET
           enabled = excluded.enabled,
           enable_agent_review = excluded.enable_agent_review,
           enable_reranking = excluded.enable_reranking,
           embedding_type = excluded.embedding_type,
           embedding_model_name = excluded.embedding_model_name,
           embedding_base_url = excluded.embedding_base_url,
           embedding_api_key = CASE
             WHEN excluded.embedding_api_key = '' AND codebase_settings.embedding_api_key <> '' THEN codebase_settings.embedding_api_key
             ELSE excluded.embedding_api_key
           END,
           embedding_dimensions = excluded.embedding_dimensions,
           batch_max_lines = excluded.batch_max_lines,
           batch_concurrency = excluded.batch_concurrency,
           chunking_max_lines_per_chunk = excluded.chunking_max_lines_per_chunk,
           chunking_min_lines_per_chunk = excluded.chunking_min_lines_per_chunk,
           chunking_min_chars_per_chunk = excluded.chunking_min_chars_per_chunk,
           chunking_overlap_lines = excluded.chunking_overlap_lines,
           reranking_model_name = excluded.reranking_model_name,
           reranking_base_url = excluded.reranking_base_url,
           reranking_api_key = CASE
             WHEN excluded.reranking_api_key = '' AND codebase_settings.reranking_api_key <> '' THEN codebase_settings.reranking_api_key
             ELSE excluded.reranking_api_key
           END,
           reranking_context_length = excluded.reranking_context_length,
           reranking_top_n = excluded.reranking_top_n,
           config_json = excluded.config_json,
           source = excluded.source,
           updated_at = datetime('now')",
        params![
            settings.profile_name,
            settings.enabled as i32,
            settings.enable_agent_review as i32,
            settings.enable_reranking as i32,
            settings.embedding_type,
            settings.embedding_model_name,
            settings.embedding_base_url,
            settings.embedding_api_key,
            settings.embedding_dimensions,
            settings.batch_max_lines,
            settings.batch_concurrency,
            settings.chunking_max_lines_per_chunk,
            settings.chunking_min_lines_per_chunk,
            settings.chunking_min_chars_per_chunk,
            settings.chunking_overlap_lines,
            settings.reranking_model_name,
            settings.reranking_base_url,
            settings.reranking_api_key,
            settings.reranking_context_length,
            settings.reranking_top_n,
            settings.config_json,
            settings.source,
        ],
    )?;

    Ok(())
}
