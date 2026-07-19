use std::path::Path;

use napi::bindgen_prelude::*;
use rusqlite::{params, Connection};

use super::super::database;

/// Sanitize a project id into a safe SQLite table name suffix.
/// Each project gets its own vector table: `cb_vec_<short_hash>`.
///
/// Uses the first 16 hex chars of blake3 (64 bits) to keep table names
/// short while maintaining negligible collision probability for project
/// counts encountered in practice.
pub fn vector_table_name(project_id: &str) -> String {
    let hash = blake3::hash(project_id.as_bytes()).to_hex();
    format!("cb_vec_{}", &hash[..16])
}

/// Ensure the vector table for the given project exists. Each project gets
/// its own table to keep vector data isolated and allow per-project cleanup.
pub fn ensure_vector_table(database_path: &Path, project_id: &str) -> Result<String> {
    let table_name = vector_table_name(project_id);
    Connection::open(database_path)
        .and_then(|connection| {
            connection.execute_batch(&format!(
                "CREATE TABLE IF NOT EXISTS {table_name} (
                   id TEXT PRIMARY KEY NOT NULL,
                   project_id TEXT NOT NULL,
                   file_path TEXT NOT NULL,
                   relative_path TEXT NOT NULL,
                   chunk_index INTEGER NOT NULL,
                   start_line INTEGER NOT NULL,
                   end_line INTEGER NOT NULL,
                   content TEXT NOT NULL,
                   embedding_json TEXT NOT NULL,
                   embedding_model TEXT NOT NULL DEFAULT '',
                   file_hash TEXT NOT NULL DEFAULT '',
                   created_at TEXT NOT NULL DEFAULT (datetime('now'))
                 );
                 CREATE INDEX IF NOT EXISTS idx_{table_name}_file
                   ON {table_name}(relative_path);
                 CREATE INDEX IF NOT EXISTS idx_{table_name}_chunk
                   ON {table_name}(relative_path, chunk_index);"
            ))
        })
        .map_err(|error| {
            database::database_error(database_path, "create codebase vector table", error)
        })?;

    Ok(table_name)
}

/// Drop the vector table for the given project (used when disabling codebase
/// or re-indexing from scratch).
pub fn drop_vector_table(database_path: &Path, project_id: &str) -> Result<()> {
    let table_name = vector_table_name(project_id);
    Connection::open(database_path)
        .and_then(|connection| {
            connection.execute_batch(&format!("DROP TABLE IF EXISTS {table_name};"))
        })
        .map_err(|error| {
            database::database_error(database_path, "drop codebase vector table", error)
        })
}

/// A single vector record to insert.
pub struct VectorInsert {
    pub id: String,
    pub file_path: String,
    pub relative_path: String,
    pub chunk_index: i32,
    pub start_line: i32,
    pub end_line: i32,
    pub content: String,
    pub embedding_json: String,
    pub embedding_model: String,
    pub file_hash: String,
}

/// Insert a batch of vectors into the project's vector table.
pub fn insert_vectors(
    database_path: &Path,
    project_id: &str,
    vectors: &[VectorInsert],
) -> Result<()> {
    let table_name = vector_table_name(project_id);
    Connection::open(database_path)
        .and_then(|mut connection| {
            let transaction = connection.transaction()?;
            // Clear existing vectors for the files being updated (by file_path)
            // to avoid duplicates when re-indexing.
            let mut seen_files: std::collections::HashSet<&str> = std::collections::HashSet::new();
            for v in vectors {
                if seen_files.insert(&v.file_path) {
                    transaction.execute(
                        &format!("DELETE FROM {table_name} WHERE file_path = ?1"),
                        params![&v.file_path],
                    )?;
                }
            }
            for v in vectors {
                transaction.execute(
                    &format!(
                        "INSERT INTO {table_name}
                         (id, project_id, file_path, relative_path, chunk_index,
                          start_line, end_line, content, embedding_json,
                          embedding_model, file_hash)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)"
                    ),
                    params![
                        &v.id,
                        project_id,
                        &v.file_path,
                        &v.relative_path,
                        v.chunk_index,
                        v.start_line,
                        v.end_line,
                        &v.content,
                        &v.embedding_json,
                        &v.embedding_model,
                        &v.file_hash,
                    ],
                )?;
            }
            transaction.commit()
        })
        .map_err(|error| {
            database::database_error(database_path, "insert codebase vectors", error)
        })
}

/// Get statistics about the indexed vectors for a project.
#[derive(Debug, Clone, Default)]
pub struct IndexStats {
    pub total_chunks: i64,
    pub total_files: i64,
    pub total_size_bytes: i64,
}

pub fn get_index_stats(database_path: &Path, project_id: &str) -> Result<IndexStats> {
    let table_name = vector_table_name(project_id);
    Connection::open(database_path)
        .and_then(|connection| {
            let total_chunks: i64 = connection.query_row(
                &format!("SELECT COUNT(*) FROM {table_name}"),
                [],
                |row| row.get(0),
            )?;
            let total_files: i64 = connection.query_row(
                &format!("SELECT COUNT(DISTINCT file_path) FROM {table_name}"),
                [],
                |row| row.get(0),
            )?;
            let total_size_bytes: i64 = connection.query_row(
                &format!("SELECT COALESCE(SUM(LENGTH(content)), 0) FROM {table_name}"),
                [],
                |row| row.get(0),
            )?;
            Ok(IndexStats {
                total_chunks,
                total_files,
                total_size_bytes,
            })
        })
        .map_err(|error| {
            database::database_error(database_path, "get codebase index stats", error)
        })
}

/// Get a map of `file_path -> file_hash` for all files that already have
/// vectors stored for the given project. Used by `start_codebase_embedding`
/// to skip files whose content hasn't changed since the last embedding run
/// (incremental re-indexing / resume after interruption).
///
/// Returns an empty map if the vector table doesn't exist yet.
pub fn get_indexed_file_hashes(database_path: &Path, project_id: &str) -> Result<std::collections::HashMap<String, String>> {
    let table_name = vector_table_name(project_id);
    let map = Connection::open(database_path)
        .and_then(|connection| {
            let mut statement = connection.prepare(&format!(
                "SELECT file_path, file_hash FROM {table_name} WHERE file_hash != ''"
            ))?;
            let rows = statement.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?;
            let mut collected = std::collections::HashMap::new();
            for row in rows {
                let (file_path, file_hash) = row?;
                collected.insert(file_path, file_hash);
            }
            Ok(collected)
        })
        .unwrap_or_default();
    Ok(map)
}

/// Delete all vectors for a specific file in the project's vector table.
/// Used by the incremental sync logic when a file is deleted from disk or
/// is no longer eligible for embedding (e.g. added to .gitignore).
///
/// Returns the number of rows deleted. Returns 0 if the table doesn't exist
/// or the file has no vectors.
pub fn delete_vectors_for_file(
    database_path: &Path,
    project_id: &str,
    file_path: &str,
) -> Result<i64> {
    let table_name = vector_table_name(project_id);
    let deleted = Connection::open(database_path)
        .and_then(|connection| {
            connection.execute(
                &format!("DELETE FROM {table_name} WHERE file_path = ?1"),
                params![file_path],
            )
        })
        .unwrap_or(0);
    Ok(deleted as i64)
}

/// Get the set of all indexed file paths for a project. Used by the
/// incremental sync logic to detect files that have been deleted from disk
/// (their vectors need to be removed).
///
/// Returns an empty set if the vector table doesn't exist yet.
pub fn get_indexed_file_paths(database_path: &Path, project_id: &str) -> Result<std::collections::HashSet<String>> {
    let table_name = vector_table_name(project_id);
    let set = Connection::open(database_path)
        .and_then(|connection| {
            let mut statement = connection.prepare(&format!(
                "SELECT DISTINCT file_path FROM {table_name}"
            ))?;
            let rows = statement.query_map([], |row| {
                Ok(row.get::<_, String>(0)?)
            })?;
            let mut collected = std::collections::HashSet::new();
            for row in rows {
                collected.insert(row?);
            }
            Ok(collected)
        })
        .unwrap_or_default();
    Ok(set)
}

/// A single search result from vector similarity search.
#[derive(Debug, Clone)]
pub struct SearchResult {
    pub file_path: String,
    pub relative_path: String,
    pub chunk_index: i32,
    pub start_line: i32,
    pub end_line: i32,
    pub content: String,
    /// Cosine similarity score in range [-1.0, 1.0]. Higher is more similar.
    pub score: f64,
}

/// Search the project's vector table for chunks most similar to the given
/// query vector. Returns up to `limit` results sorted by descending
/// cosine similarity.
///
/// This loads all stored embeddings into memory and computes cosine
/// similarity in Rust. SQLite has no native vector index, so this is the
/// simplest correct approach. For typical project sizes (thousands of
/// chunks) the in-memory computation is fast enough (< 50ms).
///
/// Returns an empty Vec if the vector table doesn't exist yet.
pub fn search_vectors(
    database_path: &Path,
    project_id: &str,
    query_vector: &[f64],
    limit: usize,
) -> Result<Vec<SearchResult>> {
    let table_name = vector_table_name(project_id);
    let query_norm = vector_norm(query_vector);
    if query_norm == 0.0 {
        return Ok(Vec::new());
    }

    let results = Connection::open(database_path)
        .and_then(|connection| {
            let mut statement = connection.prepare(&format!(
                "SELECT file_path, relative_path, chunk_index, start_line, end_line,
                        content, embedding_json
                 FROM {table_name}"
            ))?;
            let rows = statement.query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i32>(2)?,
                    row.get::<_, i32>(3)?,
                    row.get::<_, i32>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                ))
            })?;

            let mut collected: Vec<SearchResult> = Vec::new();
            for row in rows {
                let (file_path, relative_path, chunk_index, start_line, end_line, content, embedding_json) = row?;
                let stored = match serde_json::from_str::<Vec<f64>>(&embedding_json) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                let stored_norm = vector_norm(&stored);
                if stored_norm == 0.0 {
                    continue;
                }
                let dot = dot_product(query_vector, &stored);
                let score = dot / (query_norm * stored_norm);
                collected.push(SearchResult {
                    file_path,
                    relative_path,
                    chunk_index,
                    start_line,
                    end_line,
                    content,
                    score,
                });
            }
            Ok(collected)
        })
        .unwrap_or_default();

    let mut results = results;
    results.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    results.truncate(limit);
    Ok(results)
}

fn vector_norm(v: &[f64]) -> f64 {
    v.iter().map(|x| x * x).sum::<f64>().sqrt()
}

fn dot_product(a: &[f64], b: &[f64]) -> f64 {
    a.iter().zip(b.iter()).map(|(x, y)| x * y).sum()
}