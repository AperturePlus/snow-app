use std::path::Path;

use chrono::Utc;
use napi::bindgen_prelude::*;
use rusqlite::{params, Connection, OptionalExtension};

use super::super::database;
use super::super::{
    ChatConversationPage, ChatConversationRecord, ChatMessagePage, ChatMessageRecord,
};

#[derive(Clone, Debug)]
pub struct ChatContextMessage {
    pub role: String,
    pub content: String,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct ChatTokenUsage {
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_creation_input_tokens: i64,
    pub cache_read_input_tokens: i64,
}

pub struct StoreChatExchangeInput<'a> {
    pub conversation_id: &'a str,
    pub request_messages: &'a [ChatContextMessage],
    pub response_content: &'a str,
    pub response_id: &'a str,
    pub checkpoint_id: &'a str,
    pub model: &'a str,
    pub status: &'a str,
    pub raw_response_json: &'a str,
    pub token_usage: ChatTokenUsage,
    pub response_thinking: &'a str,
    pub tool_calls_json: &'a str,
    pub directory_id: &'a str,
    pub context_compaction: bool,
}

pub fn resolve_conversation_id(
    database_path: &Path,
    conversation_id: Option<&str>,
    previous_response_id: Option<&str>,
) -> Result<String> {
    if let Some(conversation_id) = conversation_id.map(str::trim).filter(|value| !value.is_empty()) {
        return Ok(conversation_id.to_string());
    }

    if let Some(previous_response_id) = previous_response_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if let Some(conversation_id) = find_conversation_id_by_response_id(database_path, previous_response_id)? {
            return Ok(conversation_id);
        }

        if conversation_exists(database_path, previous_response_id)? {
            return Ok(previous_response_id.to_string());
        }
    }

    Ok(create_chat_id("conv"))
}

pub fn load_context_messages(
    database_path: &Path,
    conversation_id: &str,
) -> Result<Vec<ChatContextMessage>> {
    Connection::open(database_path)
        .and_then(|connection| {
            let mut statement = connection.prepare(
                "SELECT role, content
                   FROM chat_messages
                  WHERE conversation_id = ?1
                    AND id >= COALESCE(
                      (SELECT id
                         FROM chat_messages
                        WHERE conversation_id = ?1
                          AND status = 'context_compaction'
                        ORDER BY id DESC
                        LIMIT 1),
                      ''
                    )
                    AND content <> ''
                    AND NOT (role = 'assistant' AND status = 'error')
                  ORDER BY id ASC",
            )?;

            let rows = statement.query_map(params![conversation_id], |row| {
                Ok(ChatContextMessage {
                    role: row.get(0)?,
                    content: row.get(1)?,
                })
            })?;

            rows.collect()
        })
        .map_err(|error| database::database_error(database_path, "load chat context", error))
}

pub fn store_chat_exchange(database_path: &Path, input: &StoreChatExchangeInput<'_>) -> Result<()> {
    Connection::open(database_path)
        .and_then(|mut connection| {
            let transaction = connection.transaction()?;
            let title = create_title(input.request_messages);
            let preview = create_snippet(input.response_content, 180);

            transaction.execute(
                "INSERT INTO chat_conversations (
                   id,
                   conversation_id,
                   title,
                   summary,
                   last_message_preview,
                   message_count,
                   model,
                   last_response_id,
                   status,
                   directory_id,
                   forked_from_conversation_id,
                   fork_message_count,
                   created_at,
                   updated_at
                 ) VALUES (
                   ?1, ?2, ?3, ?3, '', 0, ?4, ?5, 'active', ?6, '', 0, datetime('now'), datetime('now')
                 )
                 ON CONFLICT(conversation_id) DO NOTHING",
                params![
                    database::create_snowflake_id(),
                    input.conversation_id,
                    title,
                    input.model,
                    input.response_id,
                    input.directory_id,
                ],
            )?;

            if input.context_compaction {
                insert_message(
                    &transaction,
                    input.conversation_id,
                    "user",
                    input.response_content,
                    input.response_id,
                    "",
                    input.model,
                    "context_compaction",
                    input.raw_response_json,
                    "",
                    "[]",
                    0,
                )?;
            } else {
                for (index, message) in input.request_messages.iter().enumerate() {
                    let checkpoint_id = if index == 0 && normalize_role(&message.role) == "user" {
                        input.checkpoint_id
                    } else {
                        ""
                    };
                    insert_message(
                        &transaction,
                        input.conversation_id,
                        &message.role,
                        &message.content,
                        "",
                        checkpoint_id,
                        input.model,
                        "sent",
                        "{}",
                        "",
                        "[]",
                        index,
                    )?;
                }

                insert_message(
                    &transaction,
                    input.conversation_id,
                    "assistant",
                    input.response_content,
                    input.response_id,
                    "",
                    input.model,
                    input.status,
                    input.raw_response_json,
                    input.response_thinking,
                    input.tool_calls_json,
                    input.request_messages.len(),
                )?;
            }

            transaction.execute(
                "UPDATE chat_conversations
                    SET title = CASE WHEN title = '' THEN ?2 ELSE title END,
                        summary = CASE WHEN summary = '' THEN ?2 ELSE summary END,
                        last_message_preview = ?3,
                        message_count = (
                          SELECT COUNT(*)
                            FROM chat_messages
                           WHERE conversation_id = ?1
                        ),
                        model = ?4,
                        last_response_id = CASE
                          WHEN ?5 <> '' THEN ?5
                          ELSE last_response_id
                        END,
                        status = 'active',
                        directory_id = CASE WHEN directory_id = '' THEN ?10 ELSE directory_id END,
                        input_tokens = input_tokens + ?6,
                        output_tokens = output_tokens + ?7,
                        cache_creation_input_tokens = cache_creation_input_tokens + ?8,
                        cache_read_input_tokens = cache_read_input_tokens + ?9,
                        updated_at = datetime('now')
                  WHERE conversation_id = ?1",
                params![
                    input.conversation_id,
                    title,
                    preview,
                    input.model,
                    input.response_id,
                    input.token_usage.input_tokens,
                    input.token_usage.output_tokens,
                    input.token_usage.cache_creation_input_tokens,
                    input.token_usage.cache_read_input_tokens,
                    input.directory_id,
                ],
            )?;

            transaction.commit()
        })
        .map_err(|error| database::database_error(database_path, "store chat exchange", error))
}

pub fn store_failed_chat_exchange(
    database_path: &Path,
    conversation_id: Option<&str>,
    previous_response_id: Option<&str>,
    request_messages: &[ChatContextMessage],
    checkpoint_id: &str,
    model: &str,
    directory_id: &str,
    error_message: &str,
) -> Result<String> {
    let request_messages = request_messages
        .iter()
        .filter_map(|message| {
            let content = message.content.trim();
            (!content.is_empty()).then(|| ChatContextMessage {
                role: message.role.trim().to_string(),
                content: content.to_string(),
            })
        })
        .collect::<Vec<_>>();
    if request_messages.is_empty() {
        return Err(Error::from_reason("Chat message content is required"));
    }

    let conversation_id = resolve_conversation_id(
        database_path,
        conversation_id,
        previous_response_id,
    )?;
    let error_message = error_message.trim();
    let response_content = if error_message.is_empty() {
        "AI 响应失败，请稍后重试。"
    } else {
        error_message
    };

    store_chat_exchange(
        database_path,
        &StoreChatExchangeInput {
            conversation_id: &conversation_id,
            request_messages: &request_messages,
            response_content,
            response_id: "",
            checkpoint_id,
            model,
            status: "error",
            raw_response_json: "{}",
            token_usage: ChatTokenUsage::default(),
            response_thinking: "",
            tool_calls_json: "[]",
            directory_id,
            context_compaction: false,
        },
    )?;

    Ok(conversation_id)
}

pub fn append_tool_message(
    database_path: &Path,
    conversation_id: &str,
    content: &str,
) -> Result<()> {
    let trimmed_content = content.trim();
    if trimmed_content.is_empty() {
        return Ok(());
    }

    Connection::open(database_path)
        .and_then(|mut connection| {
            let transaction = connection.transaction()?;
            insert_message(
                &transaction,
                conversation_id,
                "tool",
                trimmed_content,
                "",
                "",
                "",
                "sent",
                "{}",
                "",
                "[]",
                0,
            )?;
            transaction.execute(
                "UPDATE chat_conversations
                    SET message_count = (
                          SELECT COUNT(*)
                            FROM chat_messages
                           WHERE conversation_id = ?1
                        ),
                        updated_at = datetime('now')
                  WHERE conversation_id = ?1",
                params![conversation_id],
            )?;
            transaction.commit()
        })
        .map_err(|error| database::database_error(database_path, "append tool message", error))
}

pub fn update_conversation_summary(
    database_path: &Path,
    conversation_id: &str,
    summary: &str,
) -> Result<()> {
    let trimmed_summary = summary.trim();
    if trimmed_summary.is_empty() {
        return Ok(());
    }

    Connection::open(database_path)
        .and_then(|connection| {
            connection.execute(
                "UPDATE chat_conversations
                    SET summary = ?2,
                        updated_at = datetime('now')
                  WHERE conversation_id = ?1",
                params![conversation_id, trimmed_summary],
            )
        })
        .map_err(|error| {
            database::database_error(database_path, "update conversation summary", error)
        })
        .map(|_| ())
}

pub fn list_chat_conversations(
    database_path: &Path,
    directory_id: &str,
) -> Result<Vec<ChatConversationRecord>> {
    Connection::open(database_path)
        .and_then(|connection| {
            let mut statement = connection.prepare(
                "SELECT conversation_id,
                        title,
                        summary,
                        last_message_preview,
                        message_count,
                        model,
                        status,
                        directory_id,
                        forked_from_conversation_id,
                        fork_message_count,
                        created_at,
                        updated_at,
                        input_tokens,
                        output_tokens,
                        cache_creation_input_tokens,
                        cache_read_input_tokens
                   FROM chat_conversations
                  WHERE directory_id = ?1
                    AND status = 'active'
                  ORDER BY updated_at DESC, id DESC",
            )?;

            let rows = statement.query_map(params![directory_id], |row| {
                Ok(ChatConversationRecord {
                    conversation_id: row.get(0)?,
                    title: row.get(1)?,
                    summary: row.get(2)?,
                    last_message_preview: row.get(3)?,
                    message_count: row.get(4)?,
                    model: row.get(5)?,
                    status: row.get(6)?,
                    directory_id: row.get(7)?,
                    forked_from_conversation_id: row.get(8)?,
                    fork_message_count: row.get(9)?,
                    created_at: row.get(10)?,
                    updated_at: row.get(11)?,
                    input_tokens: row.get(12)?,
                    output_tokens: row.get(13)?,
                    cache_creation_input_tokens: row.get(14)?,
                    cache_read_input_tokens: row.get(15)?,
                })
            })?;

            rows.collect()
        })
        .map_err(|error| database::database_error(database_path, "list chat conversations", error))
}

pub fn list_chat_conversations_paginated(
    database_path: &Path,
    directory_id: &str,
    limit: i32,
    offset: i32,
) -> Result<ChatConversationPage> {
    Connection::open(database_path)
        .and_then(|connection| {
            let total: i32 = connection.query_row(
                "SELECT COUNT(*)
                   FROM chat_conversations
                  WHERE directory_id = ?1
                    AND status = 'active'",
                params![directory_id],
                |row| row.get(0),
            )?;

            let safe_limit = if limit > 0 { limit } else { 20 };
            let safe_offset = if offset > 0 { offset } else { 0 };

            let mut statement = connection.prepare(
                "SELECT conversation_id,
                        title,
                        summary,
                        last_message_preview,
                        message_count,
                        model,
                        status,
                        directory_id,
                        forked_from_conversation_id,
                        fork_message_count,
                        created_at,
                        updated_at,
                        input_tokens,
                        output_tokens,
                        cache_creation_input_tokens,
                        cache_read_input_tokens
                   FROM chat_conversations
                  WHERE directory_id = ?1
                    AND status = 'active'
                  ORDER BY updated_at DESC, id DESC
                  LIMIT ?2 OFFSET ?3",
            )?;

            let rows = statement.query_map(
                params![directory_id, safe_limit, safe_offset],
                |row| {
                    Ok(ChatConversationRecord {
                        conversation_id: row.get(0)?,
                        title: row.get(1)?,
                        summary: row.get(2)?,
                        last_message_preview: row.get(3)?,
                        message_count: row.get(4)?,
                        model: row.get(5)?,
                        status: row.get(6)?,
                        directory_id: row.get(7)?,
                        forked_from_conversation_id: row.get(8)?,
                        fork_message_count: row.get(9)?,
                        created_at: row.get(10)?,
                        updated_at: row.get(11)?,
                        input_tokens: row.get(12)?,
                        output_tokens: row.get(13)?,
                        cache_creation_input_tokens: row.get(14)?,
                        cache_read_input_tokens: row.get(15)?,
                    })
                },
            )?;

            let items: Vec<ChatConversationRecord> = rows.collect::<rusqlite::Result<Vec<_>>>()?;

            Ok(ChatConversationPage { items, total })
        })
        .map_err(|error| {
            database::database_error(database_path, "list chat conversations paginated", error)
        })
}

pub fn list_pinned_conversations(
    database_path: &Path,
    directory_id: &str,
) -> Result<Vec<ChatConversationRecord>> {
    Connection::open(database_path)
        .and_then(|connection| {
            let mut statement = connection.prepare(
                "SELECT conversation_id,
                        title,
                        summary,
                        last_message_preview,
                        message_count,
                        model,
                        status,
                        directory_id,
                        forked_from_conversation_id,
                        fork_message_count,
                        created_at,
                        updated_at,
                        input_tokens,
                        output_tokens,
                        cache_creation_input_tokens,
                        cache_read_input_tokens
                   FROM chat_conversations
                  WHERE directory_id = ?1
                    AND status = 'pin'
                  ORDER BY updated_at DESC, id DESC",
            )?;

            let rows = statement.query_map(params![directory_id], |row| {
                Ok(ChatConversationRecord {
                    conversation_id: row.get(0)?,
                    title: row.get(1)?,
                    summary: row.get(2)?,
                    last_message_preview: row.get(3)?,
                    message_count: row.get(4)?,
                    model: row.get(5)?,
                    status: row.get(6)?,
                    directory_id: row.get(7)?,
                    forked_from_conversation_id: row.get(8)?,
                    fork_message_count: row.get(9)?,
                    created_at: row.get(10)?,
                    updated_at: row.get(11)?,
                    input_tokens: row.get(12)?,
                    output_tokens: row.get(13)?,
                    cache_creation_input_tokens: row.get(14)?,
                    cache_read_input_tokens: row.get(15)?,
                })
            })?;

            rows.collect()
        })
        .map_err(|error| database::database_error(database_path, "list pinned conversations", error))
}

pub fn get_chat_conversation(
    database_path: &Path,
    conversation_id: &str,
) -> Result<Option<ChatConversationRecord>> {
    Connection::open(database_path)
        .and_then(|connection| {
            connection
                .query_row(
                    "SELECT conversation_id,
                            title,
                            summary,
                            last_message_preview,
                            message_count,
                            model,
                            status,
                            directory_id,
                            forked_from_conversation_id,
                            fork_message_count,
                            created_at,
                            updated_at,
                            input_tokens,
                            output_tokens,
                            cache_creation_input_tokens,
                            cache_read_input_tokens
                       FROM chat_conversations
                      WHERE conversation_id = ?1
                      LIMIT 1",
                    params![conversation_id],
                    |row| {
                        Ok(ChatConversationRecord {
                            conversation_id: row.get(0)?,
                            title: row.get(1)?,
                            summary: row.get(2)?,
                            last_message_preview: row.get(3)?,
                            message_count: row.get(4)?,
                            model: row.get(5)?,
                            status: row.get(6)?,
                            directory_id: row.get(7)?,
                            forked_from_conversation_id: row.get(8)?,
                            fork_message_count: row.get(9)?,
                            created_at: row.get(10)?,
                            updated_at: row.get(11)?,
                            input_tokens: row.get(12)?,
                            output_tokens: row.get(13)?,
                            cache_creation_input_tokens: row.get(14)?,
                            cache_read_input_tokens: row.get(15)?,
                        })
                    },
                )
                .optional()
        })
        .map_err(|error| database::database_error(database_path, "get chat conversation", error))
}

pub fn update_conversation_status(
    database_path: &Path,
    conversation_id: &str,
    status: &str,
) -> Result<()> {
    let normalized_status = match status.trim() {
        "pin" => "pin",
        "active" => "active",
        _ => "active",
    };

    Connection::open(database_path)
        .and_then(|connection| {
            connection.execute(
                "UPDATE chat_conversations
                    SET status = ?2,
                        updated_at = datetime('now')
                  WHERE conversation_id = ?1",
                params![conversation_id, normalized_status],
            )
        })
        .map_err(|error| {
            database::database_error(database_path, "update conversation status", error)
        })
        .map(|_| ())
}

pub fn rename_conversation(
    database_path: &Path,
    conversation_id: &str,
    title: &str,
) -> Result<()> {
    let trimmed_title = title.trim();
    if trimmed_title.is_empty() {
        return Ok(());
    }

    Connection::open(database_path)
        .and_then(|connection| {
            connection.execute(
                "UPDATE chat_conversations
                    SET title = ?2,
                        summary = ?2,
                        updated_at = datetime('now')
                  WHERE conversation_id = ?1",
                params![conversation_id, trimmed_title],
            )
        })
        .map_err(|error| database::database_error(database_path, "rename conversation", error))
        .map(|_| ())
}

pub fn delete_conversation(
    database_path: &Path,
    conversation_id: &str,
) -> Result<()> {
    let mut connection = Connection::open(database_path)
        .map_err(|error| database::database_error(database_path, "delete conversation", error))?;

    let transaction = connection
        .transaction()
        .map_err(|error| database::database_error(database_path, "delete conversation", error))?;

    transaction
        .execute(
            "DELETE FROM chat_messages WHERE conversation_id = ?1",
            params![conversation_id],
        )
        .map_err(|error| database::database_error(database_path, "delete chat messages", error))?;

    // Delete all TODO items associated with this conversation session.
    transaction
        .execute(
            "DELETE FROM todo_items WHERE session_id = ?1",
            params![conversation_id],
        )
        .map_err(|error| database::database_error(database_path, "delete todo items", error))?;

    transaction
        .execute(
            "DELETE FROM chat_conversations WHERE conversation_id = ?1",
            params![conversation_id],
        )
        .map_err(|error| database::database_error(database_path, "delete conversation", error))?;

    transaction
        .commit()
        .map_err(|error| database::database_error(database_path, "delete conversation", error))?;

    Ok(())
}

pub fn list_chat_messages(
    database_path: &Path,
    conversation_id: &str,
) -> Result<Vec<ChatMessageRecord>> {
    Connection::open(database_path)
        .and_then(|connection| {
            let mut statement = connection.prepare(
                "SELECT id,
                        role,
                        content,
                        thinking,
                        status,
                        model,
                        response_id,
                        checkpoint_id,
                        tool_calls_json,
                        created_at
                   FROM chat_messages
                  WHERE conversation_id = ?1
                  ORDER BY id ASC",
            )?;

            let rows = statement.query_map(params![conversation_id], |row| {
                Ok(ChatMessageRecord {
                    id: row.get(0)?,
                    role: row.get(1)?,
                    content: row.get(2)?,
                    thinking: row.get(3)?,
                    status: row.get(4)?,
                    model: row.get(5)?,
                    response_id: row.get(6)?,
                    checkpoint_id: row.get(7)?,
                    tool_calls_json: row.get(8)?,
                    created_at: row.get(9)?,
                })
            })?;

            rows.collect()
        })
        .map_err(|error| database::database_error(database_path, "list chat messages", error))
}

pub fn list_chat_messages_paginated(
    database_path: &Path,
    conversation_id: &str,
    before_message_id: &str,
    limit: i32,
) -> Result<ChatMessagePage> {
    Connection::open(database_path)
        .and_then(|connection| {
            let total: i32 = connection.query_row(
                "SELECT COUNT(*)
                   FROM chat_messages
                  WHERE conversation_id = ?1",
                params![conversation_id],
                |row| row.get(0),
            )?;

            let safe_limit = if limit > 0 { limit } else { 10 };
            let query_limit = safe_limit.saturating_add(1);
            let mut statement = connection.prepare(
                "SELECT id,
                        role,
                        content,
                        thinking,
                        status,
                        model,
                        response_id,
                        checkpoint_id,
                        tool_calls_json,
                        created_at
                   FROM chat_messages
                  WHERE conversation_id = ?1
                    AND (?2 = '' OR id < ?2)
                  ORDER BY id DESC
                  LIMIT ?3",
            )?;

            let rows = statement.query_map(
                params![conversation_id, before_message_id, query_limit],
                |row| {
                    Ok(ChatMessageRecord {
                        id: row.get(0)?,
                        role: row.get(1)?,
                        content: row.get(2)?,
                        thinking: row.get(3)?,
                        status: row.get(4)?,
                        model: row.get(5)?,
                        response_id: row.get(6)?,
                        checkpoint_id: row.get(7)?,
                        tool_calls_json: row.get(8)?,
                        created_at: row.get(9)?,
                    })
                },
            )?;

            let mut items: Vec<ChatMessageRecord> = rows.collect::<rusqlite::Result<Vec<_>>>()?;
            let has_more = items.len() > safe_limit as usize;
            if has_more {
                items.truncate(safe_limit as usize);
            }
            items.reverse();

            Ok(ChatMessagePage {
                items,
                total,
                has_more,
            })
        })
        .map_err(|error| {
            database::database_error(database_path, "list chat messages paginated", error)
        })
}

pub fn fork_conversation(
    database_path: &Path,
    source_conversation_id: &str,
    up_to_response_id: &str,
) -> Result<ChatConversationRecord> {
    let mut connection = Connection::open(database_path)
        .map_err(|error| database::database_error(database_path, "fork conversation", error))?;

    let transaction = connection
        .transaction()
        .map_err(|error| database::database_error(database_path, "fork conversation", error))?;

    // Load source conversation metadata
    let source = transaction
        .query_row(
            "SELECT conversation_id, title, summary, directory_id, model, last_message_preview
               FROM chat_conversations
              WHERE conversation_id = ?1
              LIMIT 1",
            params![source_conversation_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                ))
            },
        )
        .map_err(|error| database::database_error(database_path, "fork conversation", error))?;

    let new_conversation_id = create_chat_id("conv");
    let new_id = database::create_snowflake_id();

    // Insert new conversation row, marking it as forked
    transaction.execute(
        "INSERT INTO chat_conversations (
           id,
           conversation_id,
           title,
           summary,
           last_message_preview,
           message_count,
           model,
           last_response_id,
           status,
           directory_id,
           forked_from_conversation_id,
           fork_message_count,
           created_at,
           updated_at
         ) VALUES (
           ?1, ?2, ?3, ?4, ?8, 0, ?5, '', 'active', ?6, ?7, 0, datetime('now'), datetime('now')
         )",
        params![
            new_id,
            new_conversation_id,
            source.1,  // title
            source.2,  // summary
            source.4,  // model
            source.3,  // directory_id
            source_conversation_id,
            source.5,  // last_message_preview
        ],
    )
    .map_err(|error| database::database_error(database_path, "fork conversation", error))?;

    // Copy messages from the source conversation. When up_to_response_id is
    // non-empty, only messages up to and including the one with that
    // response_id are copied (supports forking from an intermediate AI
    // message). When empty, all messages are copied (full fork).
    let message_rows: Vec<(String, String, String, String, String, String, String, String, String)> = {
        let mut stmt = transaction
            .prepare(
                "SELECT message_id, role, content, model, response_id, status, raw_json, thinking, tool_calls_json
                   FROM chat_messages
                  WHERE conversation_id = ?1
                    AND (?2 = '' OR id <= COALESCE(
                      (SELECT id FROM chat_messages WHERE conversation_id = ?1 AND response_id = ?2 LIMIT 1),
                      (SELECT MAX(id) FROM chat_messages WHERE conversation_id = ?1)
                    ))
                  ORDER BY id ASC",
            )
            .map_err(|error| database::database_error(database_path, "fork conversation", error))?;

        let rows = stmt
            .query_map(params![source_conversation_id, up_to_response_id], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get(7)?,
                    row.get(8)?,
                ))
            })
            .map_err(|error| database::database_error(database_path, "fork conversation", error))?;

        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| database::database_error(database_path, "fork conversation", error))?
    };

    for (index, msg) in message_rows.iter().enumerate() {
        transaction.execute(
            "INSERT INTO chat_messages (
               id,
               message_id,
               conversation_id,
               role,
               content,
               model,
               response_id,
               status,
               raw_json,
               thinking,
               tool_calls_json,
               created_at
             ) VALUES (
               ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, datetime('now')
             )",
            params![
                database::create_snowflake_id(),
                create_chat_id(&format!("msg{index}")),
                new_conversation_id,
                &msg.1,  // role
                &msg.2,  // content
                &msg.3,  // model
                &msg.4,  // response_id
                &msg.5,  // status
                &msg.6,  // raw_json
                &msg.7,  // thinking
                &msg.8,  // tool_calls_json
            ],
        )
        .map_err(|error| database::database_error(database_path, "fork conversation", error))?;
    }

    // Update message count and last_message_preview. The preview reflects
    // the last copied message, which may differ from the source conversation's
    // last message when forking from an intermediate point.
    transaction.execute(
        "UPDATE chat_conversations
            SET message_count = (
                SELECT COUNT(*) FROM chat_messages WHERE conversation_id = ?1
            ),
            fork_message_count = (
                SELECT COUNT(*) FROM chat_messages WHERE conversation_id = ?1
            ),
            last_message_preview = (
                SELECT content FROM chat_messages WHERE conversation_id = ?1 ORDER BY id DESC LIMIT 1
            ),
            updated_at = datetime('now')
          WHERE conversation_id = ?1",
        params![new_conversation_id],
    )
    .map_err(|error| database::database_error(database_path, "fork conversation", error))?;

    transaction
        .commit()
        .map_err(|error| database::database_error(database_path, "fork conversation", error))?;

    // Re-read from DB to get accurate created_at / updated_at
    get_chat_conversation(database_path, &new_conversation_id)?
        .ok_or_else(|| {
            database::database_error(
                database_path,
                "fork conversation",
                rusqlite::Error::QueryReturnedNoRows,
            )
        })
}

pub fn truncate_conversation_from_response(
    database_path: &Path,
    conversation_id: &str,
    response_id: &str,
) -> Result<()> {
    let mut connection = Connection::open(database_path)
        .map_err(|error| database::database_error(database_path, "truncate conversation", error))?;
    let transaction = connection
        .transaction()
        .map_err(|error| database::database_error(database_path, "truncate conversation", error))?;

    // Locate either an assistant response or a persisted context-compaction
    // boundary. Boundaries are user messages and must be deleted from their own row.
    let target: Option<(String, String)> = transaction
        .query_row(
            "SELECT id, status FROM chat_messages
              WHERE conversation_id = ?1 AND response_id = ?2
              LIMIT 1",
            params![conversation_id, response_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|error| database::database_error(database_path, "truncate conversation", error))?;

    let (target_id, target_status) = match target {
        Some(target) => target,
        None => return Ok(()),
    };

    let delete_from = if target_status == "context_compaction" {
        target_id.clone()
    } else {
        // Each normal exchange inserts request messages immediately before the
        // assistant response. Include that request when truncating the exchange.
        let request_id: Option<String> = transaction
            .query_row(
                "SELECT id FROM chat_messages
                  WHERE conversation_id = ?1 AND id < ?2 AND response_id = ''
                  ORDER BY id DESC
                  LIMIT 1",
                params![conversation_id, target_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| database::database_error(database_path, "truncate conversation", error))?;
        request_id.unwrap_or_else(|| target_id.clone())
    };

    // Delete linked TODO items before deleting their response rows, otherwise the
    // response-id subquery would no longer be able to locate the affected items.
    transaction
        .execute(
            "DELETE FROM todo_items
              WHERE session_id = ?1
                AND response_id IN (
                  SELECT response_id FROM chat_messages
                    WHERE conversation_id = ?1
                      AND response_id <> ''
                      AND id >= ?2
                )",
            params![conversation_id, delete_from],
        )
        .map_err(|error| database::database_error(database_path, "delete todo items", error))?;

    // Delete the selected exchange or boundary and everything after it. Messages
    // before a compaction boundary remain available to full-conversation rollback.
    transaction
        .execute(
            "DELETE FROM chat_messages
              WHERE conversation_id = ?1 AND id >= ?2",
            params![conversation_id, delete_from],
        )
        .map_err(|error| database::database_error(database_path, "truncate conversation", error))?;

    // Refresh conversation metadata so the sidebar stays consistent.
    transaction
        .execute(
            "UPDATE chat_conversations
                SET message_count = (
                      SELECT COUNT(*) FROM chat_messages WHERE conversation_id = ?1
                    ),
                    last_message_preview = COALESCE(
                      (SELECT content FROM chat_messages
                        WHERE conversation_id = ?1 ORDER BY id DESC LIMIT 1),
                      ''
                    ),
                    last_response_id = COALESCE(
                      (SELECT response_id FROM chat_messages
                        WHERE conversation_id = ?1 AND response_id <> ''
                        ORDER BY id DESC LIMIT 1),
                      ''
                    ),
                    updated_at = datetime('now')
              WHERE conversation_id = ?1",
            params![conversation_id],
        )
        .map_err(|error| database::database_error(database_path, "truncate conversation", error))?;

    transaction
        .commit()
        .map_err(|error| database::database_error(database_path, "truncate conversation", error))?;

    Ok(())
}

fn find_conversation_id_by_response_id(
    database_path: &Path,
    response_id: &str,
) -> Result<Option<String>> {
    Connection::open(database_path)
        .and_then(|connection| {
            connection
                .query_row(
                    "SELECT conversation_id
                       FROM chat_messages
                      WHERE response_id = ?1
                        AND response_id <> ''
                      ORDER BY id DESC
                      LIMIT 1",
                    [response_id],
                    |row| row.get(0),
                )
                .optional()
        })
        .map_err(|error| database::database_error(database_path, "find chat conversation", error))
}

fn conversation_exists(database_path: &Path, conversation_id: &str) -> Result<bool> {
    Connection::open(database_path)
        .and_then(|connection| {
            connection
                .query_row(
                    "SELECT 1 FROM chat_conversations WHERE conversation_id = ?1 LIMIT 1",
                    [conversation_id],
                    |_| Ok(()),
                )
                .optional()
                .map(|value| value.is_some())
        })
        .map_err(|error| database::database_error(database_path, "check chat conversation", error))
}

fn insert_message(
    connection: &Connection,
    conversation_id: &str,
    role: &str,
    content: &str,
    response_id: &str,
    checkpoint_id: &str,
    model: &str,
    status: &str,
    raw_json: &str,
    thinking: &str,
    tool_calls_json: &str,
    index: usize,
) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO chat_messages (
           id,
           message_id,
           conversation_id,
           role,
           content,
           model,
           response_id,
           checkpoint_id,
           status,
           raw_json,
           thinking,
           tool_calls_json,
           created_at
         ) VALUES (
           ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, datetime('now')
         )",
        params![
            database::create_snowflake_id(),
            create_chat_id(&format!("msg{index}")),
            conversation_id,
            normalize_role(role),
            content.trim(),
            model,
            response_id,
            checkpoint_id,
            status,
            raw_json,
            thinking.trim(),
            tool_calls_json,
        ],
    )?;

    Ok(())
}

fn normalize_role(role: &str) -> &str {
    match role.trim() {
        "assistant" => "assistant",
        "system" => "system",
        "developer" => "developer",
        "tool" => "tool",
        _ => "user",
    }
}

fn create_title(messages: &[ChatContextMessage]) -> String {
    let source = messages
        .iter()
        .find(|message| normalize_role(&message.role) == "user" && !message.content.trim().is_empty())
        .or_else(|| messages.iter().find(|message| !message.content.trim().is_empty()))
        .map(|message| message.content.as_str())
        .unwrap_or("新对话");

    create_snippet(source, 80)
}

fn create_snippet(content: &str, max_chars: usize) -> String {
    let compact = content
        .trim()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let source = if compact.is_empty() {
        content.trim()
    } else {
        compact.as_str()
    };
    let mut chars = source.chars();
    let mut snippet = chars.by_ref().take(max_chars).collect::<String>();
    if chars.next().is_some() {
        snippet.push('…');
    }
    snippet
}

fn create_chat_id(prefix: &str) -> String {
    let timestamp = Utc::now()
        .timestamp_nanos_opt()
        .unwrap_or_else(|| Utc::now().timestamp_micros() * 1_000);
    format!("{prefix}-{timestamp}-{}", std::process::id())
}
