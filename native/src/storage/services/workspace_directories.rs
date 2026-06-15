use std::path::Path;

use napi::bindgen_prelude::*;
use rusqlite::{params, Connection};

use super::super::database;
use super::super::{
    WorkspaceDirectoryInput, WorkspaceDirectoryPage, WorkspaceDirectoryRecord,
};

const DEFAULT_PAGE_LIMIT: i32 = 30;
const MAX_PAGE_LIMIT: i32 = 100;

pub fn list_workspace_directories(database_path: &Path) -> Result<Vec<WorkspaceDirectoryRecord>> {
    Connection::open(database_path)
        .and_then(|connection| query_workspace_directories(&connection))
        .map_err(|error| {
            database::database_error(database_path, "list workspace directories", error)
        })
}

pub fn list_workspace_directories_page(
    database_path: &Path,
    offset: i32,
    limit: i32,
) -> Result<WorkspaceDirectoryPage> {
    Connection::open(database_path)
        .and_then(|connection| query_workspace_directories_page(&connection, offset, limit))
        .map_err(|error| {
            database::database_error(database_path, "list workspace directories page", error)
        })
}

pub fn upsert_workspace_directory(
    database_path: &Path,
    item: &WorkspaceDirectoryInput,
) -> Result<()> {
    Connection::open(database_path)
        .and_then(|mut connection| {
            let transaction = connection.transaction()?;

            if item.is_active {
                transaction.execute(
                    "UPDATE workspace_directories
                        SET is_active = 0,
                            updated_at = datetime('now')
                      WHERE is_active = 1",
                    [],
                )?;
            }

            upsert_workspace_directory_with_connection(&transaction, item)?;
            transaction.commit()
        })
        .map_err(|error| {
            database::database_error(database_path, "upsert workspace directory", error)
        })
}

pub fn activate_workspace_directory(database_path: &Path, directory_id: &str) -> Result<()> {
    Connection::open(database_path)
        .and_then(|mut connection| {
            let transaction = connection.transaction()?;
            transaction.execute(
                "UPDATE workspace_directories
                    SET is_active = 0,
                        updated_at = datetime('now')
                  WHERE is_active = 1",
                [],
            )?;
            transaction.execute(
                "UPDATE workspace_directories
                    SET is_active = 1,
                        updated_at = datetime('now')
                  WHERE directory_id = ?1",
                [directory_id],
            )?;
            transaction.commit()
        })
        .map_err(|error| {
            database::database_error(database_path, "activate workspace directory", error)
        })
}

pub fn reorder_workspace_directories(database_path: &Path, directory_ids: Vec<String>) -> Result<()> {
    Connection::open(database_path)
        .and_then(|mut connection| {
            let transaction = connection.transaction()?;
            for (sort_order, directory_id) in directory_ids.iter().enumerate() {
                transaction.execute(
                    "UPDATE workspace_directories
                        SET sort_order = ?1,
                            updated_at = datetime('now')
                      WHERE directory_id = ?2",
                    params![sort_order as i32, directory_id],
                )?;
            }
            transaction.commit()
        })
        .map_err(|error| {
            database::database_error(database_path, "reorder workspace directories", error)
        })
}

pub fn merge_workspace_directories(
    database_path: &Path,
    source_directory_id: &str,
    target_directory_id: &str,
) -> Result<()> {
    if source_directory_id == target_directory_id {
        return Ok(());
    }

    Connection::open(database_path)
        .and_then(|connection| {
            let target = query_workspace_directory(&connection, target_directory_id)?;
            let source = query_workspace_directory(&connection, source_directory_id)?;
            let workspace_id = if target.workspace_id.is_empty() {
                target.directory_id.clone()
            } else {
                target.workspace_id.clone()
            };
            let workspace_name = if target.workspace_name.is_empty() {
                target.name.clone()
            } else {
                target.workspace_name.clone()
            };

            connection.execute(
                "UPDATE workspace_directories
                    SET workspace_id = ?1,
                        workspace_name = ?2,
                        updated_at = datetime('now')
                  WHERE directory_id IN (?3, ?4)",
                params![workspace_id, workspace_name, source.directory_id, target.directory_id],
            )?;
            Ok(())
        })
        .map_err(|error| {
            database::database_error(database_path, "merge workspace directories", error)
        })
}

pub fn split_workspace_directory(database_path: &Path, directory_id: &str) -> Result<()> {
    Connection::open(database_path)
        .and_then(|connection| {
            connection.execute(
                "UPDATE workspace_directories
                    SET workspace_id = '',
                        workspace_name = '',
                        updated_at = datetime('now')
                  WHERE directory_id = ?1",
                [directory_id],
            )?;
            Ok(())
        })
        .map_err(|error| {
            database::database_error(database_path, "split workspace directory", error)
        })
}

fn query_workspace_directories(
    connection: &Connection,
) -> rusqlite::Result<Vec<WorkspaceDirectoryRecord>> {
    let mut statement = connection.prepare(
        "SELECT id,
                directory_id,
                name,
                path,
                kind,
                workspace_id,
                workspace_name,
                is_active,
                sort_order,
                source,
                updated_at
           FROM workspace_directories
          ORDER BY sort_order ASC, id ASC",
    )?;

    let rows = statement.query_map([], map_workspace_directory_row)?;
    rows.collect()
}

fn query_workspace_directories_page(
    connection: &Connection,
    offset: i32,
    limit: i32,
) -> rusqlite::Result<WorkspaceDirectoryPage> {
    let safe_offset = offset.max(0);
    let safe_limit = if limit <= 0 { DEFAULT_PAGE_LIMIT } else { limit.min(MAX_PAGE_LIMIT) };
    let total: i32 = connection.query_row(
        "SELECT COUNT(*) FROM workspace_directories",
        [],
        |row| row.get(0),
    )?;
    let mut statement = connection.prepare(
        "SELECT id,
                directory_id,
                name,
                path,
                kind,
                workspace_id,
                workspace_name,
                is_active,
                sort_order,
                source,
                updated_at
           FROM workspace_directories
          ORDER BY sort_order ASC, id ASC
          LIMIT ?1 OFFSET ?2",
    )?;
    let rows = statement.query_map(params![safe_limit, safe_offset], map_workspace_directory_row)?;
    let items = rows.collect::<rusqlite::Result<Vec<WorkspaceDirectoryRecord>>>()?;

    Ok(WorkspaceDirectoryPage {
        items,
        total,
        offset: safe_offset,
        limit: safe_limit,
    })
}

fn query_workspace_directory(
    connection: &Connection,
    directory_id: &str,
) -> rusqlite::Result<WorkspaceDirectoryRecord> {
    connection.query_row(
        "SELECT id,
                directory_id,
                name,
                path,
                kind,
                workspace_id,
                workspace_name,
                is_active,
                sort_order,
                source,
                updated_at
           FROM workspace_directories
          WHERE directory_id = ?1",
        [directory_id],
        map_workspace_directory_row,
    )
}

fn map_workspace_directory_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<WorkspaceDirectoryRecord> {
    let is_active: i64 = row.get(7)?;

    Ok(WorkspaceDirectoryRecord {
        id: row.get(0)?,
        directory_id: row.get(1)?,
        name: row.get(2)?,
        path: row.get(3)?,
        kind: row.get(4)?,
        workspace_id: row.get(5)?,
        workspace_name: row.get(6)?,
        is_active: is_active != 0,
        sort_order: row.get(8)?,
        source: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

fn upsert_workspace_directory_with_connection(
    connection: &Connection,
    item: &WorkspaceDirectoryInput,
) -> rusqlite::Result<()> {
    let workspace_id = item.workspace_id.clone().unwrap_or_default();
    let workspace_name = item.workspace_name.clone().unwrap_or_default();

    connection.execute(
        "INSERT INTO workspace_directories (
           directory_id,
           name,
           path,
           kind,
           workspace_id,
           workspace_name,
           is_active,
           sort_order,
           source,
           created_at,
           updated_at
         ) VALUES (
           ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, datetime('now'), datetime('now')
         )
         ON CONFLICT(directory_id) DO UPDATE SET
           name = excluded.name,
           path = excluded.path,
           kind = excluded.kind,
           workspace_id = excluded.workspace_id,
           workspace_name = excluded.workspace_name,
           is_active = excluded.is_active,
           sort_order = excluded.sort_order,
           source = excluded.source,
           updated_at = datetime('now')",
        params![
            item.directory_id,
            item.name,
            item.path,
            item.kind,
            workspace_id,
            workspace_name,
            item.is_active as i32,
            item.sort_order,
            item.source,
        ],
    )?;

    Ok(())
}
