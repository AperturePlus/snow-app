use std::path::Path;

use napi::bindgen_prelude::*;
use napi_derive::napi;
use rusqlite::{params, Connection, Row};

use super::super::database;

#[napi(object)]
pub struct AppLogInput {
    pub level: String,
    pub module: String,
    pub func: String,
    pub line: Option<i32>,
    pub message: String,
    pub input: Option<String>,
    pub output: Option<String>,
    pub duration: Option<String>,
    pub context: Option<String>,
    pub error: Option<String>,
    pub source: String,
}

#[napi(object)]
pub struct AppLogRecord {
    pub id: String,
    pub level: String,
    pub module: String,
    pub func: String,
    pub line: Option<i32>,
    pub message: String,
    pub input: String,
    pub output: String,
    pub duration: String,
    pub context: String,
    pub error: String,
    pub source: String,
    pub created_at: String,
}

#[napi(object)]
pub struct AppLogPage {
    pub items: Vec<AppLogRecord>,
    pub total: i32,
}

pub fn insert_app_log(database_path: &Path, input: &AppLogInput) -> Result<()> {
    Connection::open(database_path)
        .and_then(|connection| {
            connection.execute(
                "INSERT INTO app_logs (
                   id, level, module, func, line, message,
                   input, output, duration, context, error, source, created_at
                 ) VALUES (
                   ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
                   datetime('now', 'localtime')
                 )",
                params![
                    database::create_snowflake_id(),
                    input.level.trim(),
                    input.module.trim(),
                    input.func.trim(),
                    input.line,
                    input.message.trim(),
                    input.input.as_deref().unwrap_or("").trim(),
                    input.output.as_deref().unwrap_or("").trim(),
                    input.duration.as_deref().unwrap_or("").trim(),
                    input.context.as_deref().unwrap_or("").trim(),
                    input.error.as_deref().unwrap_or("").trim(),
                    input.source.trim(),
                ],
            )
        })
        .map_err(|error| database::database_error(database_path, "insert app log", error))
        .map(|_| ())
}

pub fn list_app_logs(
    database_path: &Path,
    level: &str,
    module: &str,
    since: &str,
    until: &str,
    limit: i32,
    offset: i32,
) -> Result<AppLogPage> {
    let safe_limit = if limit > 0 { limit } else { 100 };
    let safe_offset = if offset > 0 { offset } else { 0 };

    let filter_level = !level.trim().is_empty();
    let filter_module = !module.trim().is_empty();
    let filter_since = !since.trim().is_empty();
    let filter_until = !until.trim().is_empty();

    Connection::open(database_path)
        .and_then(|connection| {
            let mut where_clauses: Vec<String> = Vec::new();
            if filter_level {
                where_clauses.push("level = ?1".to_string());
            }
            if filter_module {
                where_clauses.push("module = ?2".to_string());
            }
            if filter_since {
                where_clauses.push("created_at >= ?3".to_string());
            }
            if filter_until {
                where_clauses.push("created_at <= ?4".to_string());
            }
            let where_sql = if where_clauses.is_empty() {
                String::new()
            } else {
                format!(" WHERE {}", where_clauses.join(" AND "))
            };

            let level_param = level.trim();
            let module_param = module.trim();
            let since_param = since.trim();
            let until_param = until.trim();

            let count_sql = format!("SELECT COUNT(*) FROM app_logs{where_sql}");
            let total: i32 = connection.query_row(
                &count_sql,
                params![level_param, module_param, since_param, until_param],
                |row| row.get(0),
            )?;

            let list_sql = format!(
                "SELECT id, level, module, func, line, message,
                        input, output, duration, context, error, source, created_at
                   FROM app_logs{where_sql}
                  ORDER BY created_at DESC, id DESC
                  LIMIT ?5 OFFSET ?6"
            );

            let mut statement = connection.prepare(&list_sql)?;
            let rows = statement.query_map(
                params![
                    level_param,
                    module_param,
                    since_param,
                    until_param,
                    safe_limit,
                    safe_offset
                ],
                map_log_row,
            )?;

            let items: Vec<AppLogRecord> = rows.collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(AppLogPage { items, total })
        })
        .map_err(|error| database::database_error(database_path, "list app logs", error))
}

pub fn clear_app_logs(database_path: &Path) -> Result<u32> {
    Connection::open(database_path)
        .and_then(|connection| connection.execute("DELETE FROM app_logs", []))
        .map_err(|error| database::database_error(database_path, "clear app logs", error))
        .map(|count| count as u32)
}

/// Write an API-layer warning log (tool JSON parse failure, empty response, etc.).
/// Failures are silently ignored to avoid disrupting the main request flow.
pub fn log_api_warning(database_path: &Path, func: &str, message: &str, context: &str) {
    let _ = insert_app_log(
        database_path,
        &AppLogInput {
            level: "warning".to_string(),
            module: "api".to_string(),
            func: func.to_string(),
            line: None,
            message: message.to_string(),
            input: None,
            output: None,
            duration: None,
            context: Some(context.to_string()),
            error: None,
            source: "main".to_string(),
        },
    );
}

/// Write an API-layer error log (request failure, stream error, etc.).
/// Failures are silently ignored to avoid disrupting the main request flow.
pub fn log_api_error(database_path: &Path, func: &str, message: &str, error: &str) {
    let _ = insert_app_log(
        database_path,
        &AppLogInput {
            level: "error".to_string(),
            module: "api".to_string(),
            func: func.to_string(),
            line: None,
            message: message.to_string(),
            input: None,
            output: None,
            duration: None,
            context: None,
            error: Some(error.to_string()),
            source: "main".to_string(),
        },
    );
}

fn map_log_row(row: &Row<'_>) -> rusqlite::Result<AppLogRecord> {
    Ok(AppLogRecord {
        id: row.get(0)?,
        level: row.get(1)?,
        module: row.get(2)?,
        func: row.get(3)?,
        line: row.get(4)?,
        message: row.get(5)?,
        input: row.get(6)?,
        output: row.get(7)?,
        duration: row.get(8)?,
        context: row.get(9)?,
        error: row.get(10)?,
        source: row.get(11)?,
        created_at: row.get(12)?,
    })
}
