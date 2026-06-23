use std::path::Path;

use chrono::Utc;
use napi::bindgen_prelude::*;
use rusqlite::{params, Connection, OptionalExtension};

use super::super::database;
use super::super::ChatConversationRecord;

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
    pub model: &'a str,
    pub status: &'a str,
    pub raw_response_json: &'a str,
    pub token_usage: ChatTokenUsage,
    pub response_thinking: &'a str,
    pub tool_calls_json: &'a str,
    pub directory_id: &'a str,
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
                    AND content <> ''
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
                   created_at,
                   updated_at
                 ) VALUES (
                   ?1, ?2, ?3, ?3, '', 0, ?4, ?5, 'active', ?6, datetime('now'), datetime('now')
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

            for (index, message) in input.request_messages.iter().enumerate() {
                insert_message(
                    &transaction,
                    input.conversation_id,
                    &message.role,
                    &message.content,
                    "",
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
                input.model,
                input.status,
                input.raw_response_json,
                input.response_thinking,
                input.tool_calls_json,
                input.request_messages.len(),
            )?;

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
                        last_response_id = ?5,
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
                        created_at,
                        updated_at
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
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                })
            })?;

            rows.collect()
        })
        .map_err(|error| database::database_error(database_path, "list chat conversations", error))
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
            conversation_id,
            normalize_role(role),
            content.trim(),
            model,
            response_id,
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
