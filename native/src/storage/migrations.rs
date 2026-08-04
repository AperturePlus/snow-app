//! Database schema migrations for existing databases created by older app
//! versions.
//!
//! Migrations are split into two phases because of ordering constraints
//! relative to `CREATE TABLE IF NOT EXISTS`:
//!
//! 1. **Pre-schema** (`run_pre_schema_migrations`) — runs *before* the
//!    `CREATE TABLE` batch. Used when a table must be dropped and recreated
//!    because its fundamental structure (e.g. primary key column type)
//!    changed in an incompatible way.
//!
//! 2. **Post-schema** (`run_post_schema_migrations`) — runs *after* the
//!    `CREATE TABLE` batch. Used for additive changes (e.g. `ALTER TABLE
//!    ADD COLUMN`) that are idempotent: a no-op when the column already
//!    exists (fresh databases get it from `CREATE TABLE`).
//!
//! ## Adding a new migration
//!
//! 1. If the migration is **additive** (new column, new index), add a function
//!    and call it from `run_post_schema_migrations`.
//! 2. If the migration requires **rebuilding** a table, add a function and
//!    call it from `run_pre_schema_migrations`.
//! 3. Bump the `user_version` pragma in `database::create_schema` to the new
//!    version number.
//! 4. Each migration function MUST be idempotent — running it on a database
//!    that has already been migrated must be a safe no-op.

use rusqlite::Connection;

/// Tables whose legacy schema used `INTEGER PRIMARY KEY`. When detected, the
/// table is dropped so `CREATE TABLE` can recreate it with a `TEXT PRIMARY KEY`
/// (snowflake ID) column.
///
/// This list is frozen — it only covers tables that existed before the
/// snowflake-ID migration. Tables added after that migration always use
/// `TEXT PRIMARY KEY` from creation and never need to appear here.
const LEGACY_INTEGER_PRIMARY_KEY_TABLES: &[&str] = &[
    "system_settings",
    "api_configs",
    "codebase_settings",
    "system_prompts",
    "custom_header_schemes",
    "workspace_directories",
    "mcp_server_configs",
    "sub_agent_configs",
    "sensitive_command_configs",
    "chat_conversations",
    "sub_agent_sessions",
    "chat_messages",
    "usage_records",
];

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/// Runs migrations that must execute **before** `CREATE TABLE IF NOT EXISTS`.
///
/// Currently this handles the one-time rebuild of legacy tables that used
/// `INTEGER PRIMARY KEY` so they can be recreated with `TEXT PRIMARY KEY`
/// (snowflake IDs). On databases already using TEXT primary keys this is a
/// fast no-op.
pub fn run_pre_schema_migrations(connection: &Connection) -> rusqlite::Result<()> {
    reset_legacy_integer_primary_key_tables(connection)
}

/// Runs migrations that must execute **after** `CREATE TABLE IF NOT EXISTS`.
///
/// Each function below is idempotent and targets a specific additive schema
/// change (e.g. adding a column that old databases lack but fresh databases
/// already have via `CREATE TABLE`).
pub fn run_post_schema_migrations(connection: &Connection) -> rusqlite::Result<()> {
    migrate_chat_conversations_api_profile(connection)?;
    migrate_plugins_runtime(connection)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Pre-schema migrations
// ---------------------------------------------------------------------------

/// Drops every table in [`LEGACY_INTEGER_PRIMARY_KEY_TABLES`] that still has
/// an `INTEGER` primary key named `id`, so the subsequent `CREATE TABLE`
/// batch can recreate them with `TEXT PRIMARY KEY`.
///
/// This is a destructive migration — it deletes all rows in the affected
/// tables. It is acceptable because the project had not been released when
/// the snowflake-ID migration was applied; development databases are expected
/// to be rebuilt.
fn reset_legacy_integer_primary_key_tables(connection: &Connection) -> rusqlite::Result<()> {
    let has_legacy_primary_key = LEGACY_INTEGER_PRIMARY_KEY_TABLES
        .iter()
        .try_fold(false, |found, table_name| {
            Ok::<bool, rusqlite::Error>(
                found || has_integer_primary_key(connection, table_name)?,
            )
        })?;

    if !has_legacy_primary_key {
        return Ok(());
    }

    // Disable foreign keys during the drop so cascading constraints don't
    // fire while dependent tables are being removed in arbitrary order.
    // They are re-enabled immediately after, and the subsequent CREATE TABLE
    // batch will re-establish the schema with proper FK constraints.
    connection.execute_batch("PRAGMA foreign_keys = OFF;")?;
    for table_name in LEGACY_INTEGER_PRIMARY_KEY_TABLES {
        connection.execute(&format!("DROP TABLE IF EXISTS {table_name}"), [])?;
    }
    connection.execute_batch("PRAGMA foreign_keys = ON;")?;

    Ok(())
}

/// Returns `true` when `table_name` has a column named `id` that is both an
/// `INTEGER` type and part of the primary key.
fn has_integer_primary_key(connection: &Connection, table_name: &str) -> rusqlite::Result<bool> {
    let mut statement = connection.prepare(&format!("PRAGMA table_info({table_name})"))?;
    let mut columns = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, i32>(5)?,
        ))
    })?;

    columns.try_fold(false, |found, column| {
        let (column_name, column_type, primary_key_index) = column?;
        Ok(found
            || (column_name == "id"
                && primary_key_index > 0
                && column_type.eq_ignore_ascii_case("INTEGER")))
    })
}

// ---------------------------------------------------------------------------
// Post-schema migrations
// ---------------------------------------------------------------------------

/// Adds the `api_profile_name` column to `chat_conversations` for databases
/// created by older app versions.
///
/// The column binds a conversation to a specific API config profile so
/// different conversations can route to different providers/models. An empty
/// string means "follow the global active profile" (the legacy behaviour).
///
/// Idempotent: no-op when the column is already present (fresh databases get
/// it from the `CREATE TABLE` statement in `create_schema`).
fn migrate_chat_conversations_api_profile(connection: &Connection) -> rusqlite::Result<()> {
    let mut statement = connection.prepare("PRAGMA table_info(chat_conversations)")?;
    let mut columns = statement.query_map([], |row| row.get::<_, String>(1))?;
    let has_api_profile_column = columns.try_fold(false, |found, column| {
        Ok::<bool, rusqlite::Error>(found || column? == "api_profile_name")
    })?;

    if !has_api_profile_column {
        connection.execute(
            "ALTER TABLE chat_conversations
                ADD COLUMN api_profile_name TEXT NOT NULL DEFAULT ''",
            [],
        )?;
    }

    Ok(())
}

/// Adds the `runtime_json` column to the `plugins` table for databases that
/// were created with an earlier plugin schema.
///
/// The column stores the serialized plugin runtime declaration (entry,
/// permissions, timeout). Idempotent: no-op when the column is already
/// present (fresh databases get it from `CREATE TABLE` in `create_schema`).
fn migrate_plugins_runtime(connection: &Connection) -> rusqlite::Result<()> {
    let mut statement = connection.prepare("PRAGMA table_info(plugins)")?;
    let mut columns = statement.query_map([], |row| row.get::<_, String>(1))?;
    let has_runtime_column = columns.try_fold(false, |found, column| {
        Ok::<bool, rusqlite::Error>(found || column? == "runtime_json")
    })?;

    if !has_runtime_column {
        connection.execute(
            "ALTER TABLE plugins ADD COLUMN runtime_json TEXT NOT NULL DEFAULT 'null'",
            [],
        )?;
    }

    Ok(())
}
