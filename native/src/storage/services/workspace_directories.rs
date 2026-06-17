use std::path::Path;

use napi::bindgen_prelude::*;
use rusqlite::{params, Connection};

use super::super::database;
use super::super::{WorkspaceDirectoryInput, WorkspaceDirectoryRecord};

pub fn list_workspace_directories(database_path: &Path) -> Result<Vec<WorkspaceDirectoryRecord>> {
    Connection::open(database_path)
        .and_then(|connection| query_workspace_directories(&connection))
        .map_err(|error| {
            database::database_error(database_path, "list workspace directories", error)
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

pub fn reorder_workspace_directories(
    database_path: &Path,
    items: &[WorkspaceDirectoryInput],
) -> Result<()> {
    Connection::open(database_path)
        .and_then(|mut connection| {
            let transaction = connection.transaction()?;

            for (index, item) in items.iter().enumerate() {
                transaction.execute(
                    "UPDATE workspace_directories
                        SET sort_order = ?1,
                            updated_at = datetime('now')
                      WHERE directory_id = ?2",
                    params![index as i32, &item.directory_id],
                )?;
            }

            transaction.commit()
        })
        .map_err(|error| {
            database::database_error(database_path, "reorder workspace directories", error)
        })
}

pub fn delete_workspace_directory(database_path: &Path, directory_id: &str) -> Result<()> {
    Connection::open(database_path)
        .and_then(|mut connection| {
            let transaction = connection.transaction()?;
            transaction.execute(
                "DELETE FROM workspace_directories WHERE directory_id = ?1",
                [directory_id],
            )?;
            normalize_workspace_directory_state(&transaction)?;
            transaction.commit()
        })
        .map_err(|error| {
            database::database_error(database_path, "delete workspace directory", error)
        })
}

fn normalize_workspace_directory_state(connection: &Connection) -> rusqlite::Result<()> {
    let directory_ids = {
        let mut statement = connection.prepare(
            "SELECT directory_id
               FROM workspace_directories
              ORDER BY sort_order ASC, id ASC",
        )?;
        let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
        rows.collect::<rusqlite::Result<Vec<String>>>()?
    };

    for (index, directory_id) in directory_ids.iter().enumerate() {
        connection.execute(
            "UPDATE workspace_directories
                SET sort_order = ?1,
                    updated_at = datetime('now')
              WHERE directory_id = ?2",
            params![index as i32, directory_id],
        )?;
    }

    let active_count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM workspace_directories WHERE is_active = 1",
        [],
        |row| row.get(0),
    )?;

    if active_count == 0 {
        if let Some(first_directory_id) = directory_ids.first() {
            connection.execute(
                "UPDATE workspace_directories
                    SET is_active = 1,
                        updated_at = datetime('now')
                  WHERE directory_id = ?1",
                [first_directory_id],
            )?;
        }
    }

    Ok(())
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
                is_active,
                sort_order,
                source,
                updated_at
           FROM workspace_directories
          ORDER BY sort_order ASC, id ASC",
    )?;

    let rows = statement.query_map([], |row| {
        let is_active: i64 = row.get(5)?;

        Ok(WorkspaceDirectoryRecord {
            id: row.get(0)?,
            directory_id: row.get(1)?,
            name: row.get(2)?,
            path: row.get(3)?,
            kind: row.get(4)?,
            is_active: is_active != 0,
            sort_order: row.get(6)?,
            source: row.get(7)?,
            updated_at: row.get(8)?,
        })
    })?;

    rows.collect()
}

fn upsert_workspace_directory_with_connection(
    connection: &Connection,
    item: &WorkspaceDirectoryInput,
) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO workspace_directories (
           id,
           directory_id,
           name,
           path,
           kind,
           is_active,
           sort_order,
           source,
           created_at,
           updated_at
         ) VALUES (
           ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, datetime('now'), datetime('now')
         )
         ON CONFLICT(directory_id) DO UPDATE SET
           name = excluded.name,
           path = excluded.path,
           kind = excluded.kind,
           is_active = excluded.is_active,
           sort_order = excluded.sort_order,
           source = excluded.source,
           updated_at = datetime('now')",
        params![
            database::create_snowflake_id(),
            item.directory_id,
            item.name,
            item.path,
            item.kind,
            item.is_active as i32,
            item.sort_order,
            item.source,
        ],
    )?;

    Ok(())
}
