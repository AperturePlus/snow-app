#![allow(dead_code)]

use std::sync::Arc;

use napi::bindgen_prelude::*;
use rusqlite::{Connection, OptionalExtension};
use serde_json::{json, Value};
use tokio::sync::Mutex;

use super::super::service::McpService;
use super::super::tools::McpTool;

const SERVER_ID: &str = "todo";

/// TODO item stored in SQLite.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct TodoItem {
    id: String,
    content: String,
    status: String,
    #[serde(rename = "createdAt")]
    created_at: String,
    #[serde(rename = "updatedAt")]
    updated_at: String,
    #[serde(rename = "parentId")]
    parent_id: Option<String>,
    #[serde(rename = "responseId", skip_serializing_if = "String::is_empty")]
    response_id: String,
}

/// The session-scoped TODO service backed by SQLite.
///
/// All mutating operations go through `spawn_blocking` so the Node.js event
/// loop is never blocked by synchronous SQLite I/O.
pub struct TodoService {
    db_path: String,
    /// Per-session lock to serialise concurrent mutations for the same session.
    /// Keyed by session_id (passed as part of tool args).
    session_locks: Arc<Mutex<std::collections::HashMap<String, Arc<Mutex<()>>>>>,
}

impl TodoService {
    pub fn new() -> Self {
        let storage_info = crate::storage::initialize_app_storage().map_err(|e| {
            Error::new(
                Status::GenericFailure,
                format!("Failed to initialize app storage: {e}"),
            )
        });
        // If storage init fails we still want the service to be constructible
        // (it will error on actual tool execution instead).
        let db_path = match storage_info {
            Ok(info) => info.database_path,
            Err(_) => String::new(),
        };

        TodoService {
            db_path,
            session_locks: Arc::new(Mutex::new(std::collections::HashMap::new())),
        }
    }

    fn get_connection(&self) -> napi::Result<Connection> {
        let conn = Connection::open(&self.db_path).map_err(|e| {
            Error::new(
                Status::GenericFailure,
                format!("Failed to open database: {e}"),
            )
        })?;
        Ok(conn)
    }

    /// List TODO items created by add actions that will be deleted when
    /// rolling back to the given response_id. Returns items whose response
    /// belongs to an assistant message at or after the rollback boundary.
    pub fn list_todos_for_rollback(
        session_id: &str,
        response_id: &str,
    ) -> napi::Result<String> {
        let storage_info = crate::storage::initialize_app_storage().map_err(|e| {
            Error::new(
                Status::GenericFailure,
                format!("Failed to initialize app storage: {e}"),
            )
        })?;
        let conn = Connection::open(&storage_info.database_path).map_err(|e| {
            Error::new(
                Status::GenericFailure,
                format!("Failed to open database: {e}"),
            )
        })?;

        let mut stmt = conn
            .prepare(
                "SELECT id, content, status, created_at, updated_at, parent_id, response_id \
                 FROM todo_items \
                 WHERE session_id = ?1 \
                   AND response_id IN ( \
                     SELECT response_id FROM chat_messages \
                       WHERE conversation_id = ?1 \
                         AND response_id <> '' \
                         AND id >= ( \
                           SELECT id FROM chat_messages \
                             WHERE conversation_id = ?1 AND response_id = ?2 \
                             LIMIT 1 \
                         ) \
                   ) \
                 ORDER BY created_at ASC",
            )
            .map_err(|e| {
                Error::new(Status::GenericFailure, format!("Prepare failed: {e}"))
            })?;

        let items: Vec<TodoItem> = stmt
            .query_map(rusqlite::params![session_id, response_id], |row| {
                Ok(TodoItem {
                    id: row.get(0)?,
                    content: row.get(1)?,
                    status: row.get(2)?,
                    created_at: row.get(3)?,
                    updated_at: row.get(4)?,
                    parent_id: row.get(5)?,
                    response_id: row.get(6)?,
                })
            })
            .map_err(|e| {
                Error::new(Status::GenericFailure, format!("Query failed: {e}"))
            })?
            .collect::<rusqlite::Result<Vec<TodoItem>>>()
            .map_err(|e| {
                Error::new(Status::GenericFailure, format!("Row parse failed: {e}"))
            })?;

        serde_json::to_string(&items).map_err(|e| {
            Error::new(
                Status::GenericFailure,
                format!("Failed to serialize todos: {e}"),
            )
        })
    }

    async fn get_session_lock(&self, session_id: &str) -> Arc<Mutex<()>> {
        let mut map = self.session_locks.lock().await;
        map.entry(session_id.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }

    // ------------------------------------------------------------------
    // Database helpers (run inside spawn_blocking)
    // ------------------------------------------------------------------

    fn get_todos_for_session(conn: &Connection, session_id: &str) -> napi::Result<Vec<TodoItem>> {
        let mut stmt = conn
            .prepare(
                "SELECT id, content, status, created_at, updated_at, parent_id, response_id \
                 FROM todo_items WHERE session_id = ?1 ORDER BY created_at ASC",
            )
            .map_err(|e| {
                Error::new(Status::GenericFailure, format!("Prepare failed: {e}"))
            })?;

        let items: Vec<TodoItem> = stmt
            .query_map([session_id], |row| {
                Ok(TodoItem {
                    id: row.get(0)?,
                    content: row.get(1)?,
                    status: row.get(2)?,
                    created_at: row.get(3)?,
                    updated_at: row.get(4)?,
                    parent_id: row.get(5)?,
                    response_id: row.get(6)?,
                })
            })
            .map_err(|e| {
                Error::new(Status::GenericFailure, format!("Query failed: {e}"))
            })?
            .collect::<rusqlite::Result<Vec<TodoItem>>>()
            .map_err(|e| {
                Error::new(Status::GenericFailure, format!("Row parse failed: {e}"))
            })?;

        Ok(items)
    }

    fn add_todo(
        conn: &Connection,
        session_id: &str,
        id: &str,
        content: &str,
        parent_id: Option<&str>,
        response_id: &str,
    ) -> napi::Result<()> {
        let now = now_iso();
        conn.execute(
            "INSERT INTO todo_items (id, session_id, content, status, created_at, updated_at, parent_id, response_id) \
             VALUES (?1, ?2, ?3, 'pending', ?4, ?5, ?6, ?7)",
            rusqlite::params![id, session_id, content, &now, &now, parent_id, response_id],
        )
        .map_err(|e| {
            Error::new(Status::GenericFailure, format!("Insert failed: {e}"))
        })?;
        Ok(())
    }

    fn update_todos(
        conn: &Connection,
        session_id: &str,
        ids: &[String],
        status: Option<&str>,
        content: Option<&str>,
    ) -> napi::Result<bool> {
        let now = now_iso();
        let mut any_found = false;
        for id in ids {
            let existing = conn
                .query_row(
                    "SELECT id FROM todo_items WHERE id = ?1 AND session_id = ?2",
                    rusqlite::params![id, session_id],
                    |_| Ok(()),
                )
                .optional()
                .map_err(|e| {
                    Error::new(Status::GenericFailure, format!("Query failed: {e}"))
                })?;
            if existing.is_none() {
                continue;
            }
            any_found = true;

            if let Some(s) = status {
                conn.execute(
                    "UPDATE todo_items SET status = ?1, updated_at = ?2 WHERE id = ?3 AND session_id = ?4",
                    rusqlite::params![s, &now, id, session_id],
                )
                .map_err(|e| {
                    Error::new(Status::GenericFailure, format!("Update failed: {e}"))
                })?;
            }

            if let Some(c) = content {
                conn.execute(
                    "UPDATE todo_items SET content = ?1, updated_at = ?2 WHERE id = ?3 AND session_id = ?4",
                    rusqlite::params![c, &now, id, session_id],
                )
                .map_err(|e| {
                    Error::new(Status::GenericFailure, format!("Update failed: {e}"))
                })?;
            }
        }
        Ok(any_found)
    }

    fn delete_todos(
        conn: &Connection,
        session_id: &str,
        ids: &[String],
    ) -> napi::Result<()> {
        let id_set: std::collections::HashSet<&str> =
            ids.iter().map(|s| s.as_str()).collect();

        // Delete the items themselves and their direct children.
        let mut to_delete: Vec<String> = Vec::new();
        let all_todos = Self::get_todos_for_session(conn, session_id)?;
        for todo in &all_todos {
            if id_set.contains(todo.id.as_str()) {
                to_delete.push(todo.id.clone());
            } else if let Some(ref pid) = todo.parent_id {
                if id_set.contains(pid.as_str()) {
                    to_delete.push(todo.id.clone());
                }
            }
        }

        for id in &to_delete {
            conn.execute(
                "DELETE FROM todo_items WHERE id = ?1 AND session_id = ?2",
                rusqlite::params![id, session_id],
            )
            .map_err(|e| {
                Error::new(Status::GenericFailure, format!("Delete failed: {e}"))
            })?;
        }
        Ok(())
    }

    // ------------------------------------------------------------------
    // Action handlers
    // ------------------------------------------------------------------

    fn execute_get(&self, args: &Value) -> napi::Result<Value> {
        let session_id = require_session_id(args)?;
        let conn = self.get_connection()?;
        let items = Self::get_todos_for_session(&conn, &session_id)?;
        let items_json: Vec<Value> = items
            .iter()
            .map(|item| serde_json::to_value(item).unwrap_or(json!({})))
            .collect();
        Ok(json!({
            "sessionId": session_id,
            "todos": items_json,
        }))
    }

    fn execute_add(&self, args: &Value) -> napi::Result<Value> {
        let session_id = require_session_id(args)?;
        let content = args
            .get("content")
            .and_then(|v| {
                if let Some(s) = v.as_str() {
                    return Some(s.to_string());
                }
                // content can also be a JSON string array
                if let Some(arr) = v.as_array() {
                    let strings: Vec<String> = arr
                        .iter()
                        .filter_map(|item| item.as_str().map(|s| s.to_string()))
                        .collect();
                    if !strings.is_empty() {
                        return Some(strings.join("\n"));
                    }
                }
                None
            })
            .ok_or_else(|| {
                Error::new(
                    Status::InvalidArg,
                    "content is required for action=add".to_string(),
                )
            })?;

        let parent_id = args
            .get("parentId")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let conn = self.get_connection()?;

        // Validate parentId if provided.
        let validated_parent = match &parent_id {
            Some(pid) if !pid.is_empty() => {
                let exists = conn
                    .query_row(
                        "SELECT 1 FROM todo_items WHERE id = ?1 AND session_id = ?2",
                        rusqlite::params![pid, &session_id],
                        |_| Ok(()),
                    )
                    .optional()
                    .map_err(|e| {
                        Error::new(Status::GenericFailure, format!("Query failed: {e}"))
                    })?;
                if exists.is_some() {
                    Some(pid.clone())
                } else {
                    None
                }
            }
            _ => None,
        };

        let response_id = args
            .get("responseId")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        let id = create_id("todo");
        Self::add_todo(
            &conn,
            &session_id,
            &id,
            &content,
            validated_parent.as_deref(),
            response_id,
        )?;

        let items = Self::get_todos_for_session(&conn, &session_id)?;
        Ok(json!({
            "sessionId": session_id,
            "todos": serde_json::to_value(&items).unwrap_or(json!([])),
        }))
    }

    fn execute_update(&self, args: &Value) -> napi::Result<Value> {
        let session_id = require_session_id(args)?;
        let todo_id_raw = args.get("todoId").ok_or_else(|| {
            Error::new(
                Status::InvalidArg,
                "todoId is required for action=update".to_string(),
            )
        })?;

        let ids: Vec<String> = if let Some(s) = todo_id_raw.as_str() {
            vec![s.to_string()]
        } else if let Some(arr) = todo_id_raw.as_array() {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        } else {
            return Err(Error::new(
                Status::InvalidArg,
                "todoId must be a string or array of strings".to_string(),
            ));
        };

        if ids.is_empty() {
            return Err(Error::new(
                Status::InvalidArg,
                "todoId must not be empty".to_string(),
            ));
        }

        let status = args.get("status").and_then(|v| v.as_str());
        if let Some(s) = status {
            if !["pending", "inProgress", "completed"].contains(&s) {
                return Err(Error::new(
                    Status::InvalidArg,
                    "status must be one of: pending, inProgress, completed".to_string(),
                ));
            }
        }

        let content = args.get("content").and_then(|v| v.as_str());

        // If neither status nor content is provided, there is nothing to
        // update. Return an error so the AI can self-correct instead of
        // silently succeeding with only a timestamp change.
        if status.is_none() && content.is_none() {
            return Err(Error::new(
                Status::InvalidArg,
                "At least one of 'status' or 'content' must be provided for action=update".to_string(),
            ));
        }

        let conn = self.get_connection()?;
        let found = Self::update_todos(&conn, &session_id, &ids, status, content)?;

        if !found {
            return Ok(json!({ "message": "TODO item not found" }));
        }

        let items = Self::get_todos_for_session(&conn, &session_id)?;
        Ok(json!({
            "sessionId": session_id,
            "todos": serde_json::to_value(&items).unwrap_or(json!([])),
        }))
    }

    fn execute_delete(&self, args: &Value) -> napi::Result<Value> {
        let session_id = require_session_id(args)?;
        let todo_id_raw = args.get("todoId").ok_or_else(|| {
            Error::new(
                Status::InvalidArg,
                "todoId is required for action=delete".to_string(),
            )
        })?;

        let ids: Vec<String> = if let Some(s) = todo_id_raw.as_str() {
            vec![s.to_string()]
        } else if let Some(arr) = todo_id_raw.as_array() {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        } else {
            return Err(Error::new(
                Status::InvalidArg,
                "todoId must be a string or array of strings".to_string(),
            ));
        };

        if ids.is_empty() {
            return Err(Error::new(
                Status::InvalidArg,
                "todoId must not be empty".to_string(),
            ));
        }

        let conn = self.get_connection()?;
        Self::delete_todos(&conn, &session_id, &ids)?;

        let items = Self::get_todos_for_session(&conn, &session_id)?;
        Ok(json!({
            "sessionId": session_id,
            "todos": serde_json::to_value(&items).unwrap_or(json!([])),
        }))
    }
}

impl McpService for TodoService {
    fn id(&self) -> &str {
        SERVER_ID
    }

    fn tools(&self) -> Vec<McpTool> {
        vec![McpTool {
            server_id: SERVER_ID.to_string(),
            name: "todo-manage".to_string(),
            description: "Unified session TODO list for AI work planning: use required field \"action\" — one of get | add | update | delete. The \"sessionId\" and \"status\" fields are required for ALL actions (status is only used by update, ignored by others).\n\nACTIONS:\n- get: Current list with IDs, status, hierarchy. Use before add/update when you need existing IDs.\n- add: Create item(s). Use \"content\" (string or string[]). Optional \"parentId\" for subtasks (valid parent id from get).\n- update: Required \"todoId\" (string or string[]). Use \"status\" (pending|inProgress|completed) and/or \"content\" (refined wording). Batch ids share the same updates.\n- delete: Required \"todoId\" (string or string[]). Deleting a parent cascades to children.\n\nBEST PRACTICES:\n- Mark \"completed\" only after the step is verified; update as you work.\n- Update each item immediately after it is done; do NOT finish all work first and batch-update at the end.\n- Delete obsolete or redundant items to keep the list focused.\n\nEXAMPLES:\n- {action:\"get\", sessionId:\"...\", status:\"pending\"}\n- {action:\"add\", sessionId:\"...\", status:\"pending\", content:[\"Step 1\",\"Step 2\"]}\n- {action:\"update\", sessionId:\"...\", status:\"completed\", todoId:\"...\"}\n- {action:\"delete\", sessionId:\"...\", status:\"pending\", todoId:\"...\"}".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["get", "add", "update", "delete"],
                        "description": "Which operation to run on the session TODO list."
                    },
                    "sessionId": {
                        "type": "string",
                        "description": "The conversation/session ID to scope the TODO list."
                    },
                    "content": {
                        "oneOf": [
                            {
                                "type": "string",
                                "description": "For action=add: one TODO description. For action=update: optional new wording."
                            },
                            {
                                "type": "array",
                                "items": { "type": "string" },
                                "description": "For action=add only: batch add multiple TODO descriptions."
                            }
                        ],
                        "description": "For add: required (string or string[]). For update: optional text refinement."
                    },
                    "parentId": {
                        "type": "string",
                        "description": "For action=add only: parent TODO id for subtasks (from action=get)."
                    },
                    "todoId": {
                        "oneOf": [
                            {
                                "type": "string",
                                "description": "Single TODO item id"
                            },
                            {
                                "type": "array",
                                "items": { "type": "string" },
                                "description": "Multiple ids (same update or delete applies to all)"
                            }
                        ],
                        "description": "For action=update or delete: item id(s) from action=get."
                    },
                    "status": {
                        "type": "string",
                        "enum": ["pending", "inProgress", "completed"],
                        "description": "ignored by get/add/delete."
                    }
                },
                "required": ["action", "sessionId", "status"]
            }),
        }]
    }

    fn execute(&self, tool_name: &str, args: &Value) -> napi::Result<Value> {
        match tool_name {
            "todo-manage" => {
                let action = args
                    .get("action")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| {
                        Error::new(
                            Status::InvalidArg,
                            "action is required (get | add | update | delete)".to_string(),
                        )
                    })?;

                // Validate sessionId is present (will be used by the async path).
                let _session_id = require_session_id(args)?;
                let service = self.clone_for_async();
                let args_clone = args.clone();

                // We cannot use async in this trait method, so we delegate to the
                // async executor in tools.rs. This synchronous execute() is only
                // used as a fallback; the real path goes through call_mcp_tool.
                match action {
                    "get" => service.execute_get(&args_clone),
                    "add" => service.execute_add(&args_clone),
                    "update" => service.execute_update(&args_clone),
                    "delete" => service.execute_delete(&args_clone),
                    _ => Err(Error::new(
                        Status::InvalidArg,
                        format!("Unknown action: {action}"),
                    )),
                }
            }
            _ => Err(Error::new(
                Status::GenericFailure,
                format!(
                    "Unknown tool: \"{}\" for MCP server \"todo\". Available tools: [mcp__todo__todo-manage]",
                    tool_name
                ),
            )),
        }
    }
}

impl TodoService {
    /// Clone the service for async execution. Since `db_path` is a String and
    /// `session_locks` is behind an Arc, this is cheap.
    fn clone_for_async(&self) -> TodoService {
        TodoService {
            db_path: self.db_path.clone(),
            session_locks: Arc::clone(&self.session_locks),
        }
    }

    /// Async entry point used by `call_mcp_tool` in tools.rs.
    pub async fn execute_async(&self, args: &Value) -> napi::Result<Value> {
        let action = args
            .get("action")
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                Error::new(
                    Status::InvalidArg,
                    "action is required (get | add | update | delete)".to_string(),
                )
            })?
            .to_string();

        let session_id = require_session_id(args)?;

        // Acquire per-session lock to serialise concurrent mutations.
        let lock = self.get_session_lock(&session_id).await;
        let _guard = lock.lock().await;

        let args_owned = args.clone();
        let db_path = self.db_path.clone();
        let session_locks = Arc::clone(&self.session_locks);

        let result = tokio::task::spawn_blocking(move || {
            let service = TodoService {
                db_path,
                session_locks,
            };
            match action.as_str() {
                "get" => service.execute_get(&args_owned),
                "add" => service.execute_add(&args_owned),
                "update" => service.execute_update(&args_owned),
                "delete" => service.execute_delete(&args_owned),
                other => Err(Error::new(
                    Status::InvalidArg,
                    format!("Unknown action: {other}"),
                )),
            }
        })
        .await
        .map_err(|e| {
            Error::new(
                Status::GenericFailure,
                format!("Task join error: {e}"),
            )
        })??;

        Ok(result)
    }
}

// ---------------------------------------------------------------------------
// Free functions
// ---------------------------------------------------------------------------

fn require_session_id(args: &Value) -> napi::Result<String> {
    args.get("sessionId")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| {
            Error::new(
                Status::InvalidArg,
                "sessionId is required for all todo-manage actions".to_string(),
            )
        })
}

fn create_id(prefix: &str) -> String {
    let now = chrono::Utc::now().timestamp_millis();
    // Use a simple counter + timestamp for uniqueness instead of the `rand` crate.
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{prefix}-{now}_{n:x}")
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}
