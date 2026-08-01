use napi::bindgen_prelude::*;
use napi::threadsafe_function::ThreadsafeFunction;
use napi_derive::napi;
use serde_json::{json, Value};

use super::super::service::McpService;
use super::super::tools::McpTool;

pub const SERVER_ID: &str = "app-control";

const TOOL_CREATE_MEMO: &str = "createMemo";
const TOOL_SET_MODE: &str = "setMode";
const TOOL_OPEN_SETTINGS: &str = "openSettings";
const TOOL_CREATE_SCHEDULED_TASK: &str = "createScheduledTask";

#[napi(object)]
pub struct AppControlCommand {
    /// Action identifier: "create_memo" | "set_mode" | "open_settings" | "create_scheduled_task"
    pub action: String,
    /// JSON-encoded action payload
    pub payload_json: String,
}

pub type AppControlCallback =
    ThreadsafeFunction<AppControlCommand, Promise<String>, AppControlCommand, Status, false>;

pub struct AppControlService;

impl AppControlService {
    pub fn new() -> Self {
        AppControlService
    }

    pub async fn execute_async(
        &self,
        tool_name: &str,
        args: &Value,
        on_app_control: &AppControlCallback,
    ) -> napi::Result<Value> {
        let (action, payload) = match tool_name {
            TOOL_CREATE_MEMO => validate_create_memo_args(args)?,
            TOOL_SET_MODE => validate_set_mode_args(args)?,
            TOOL_OPEN_SETTINGS => validate_open_settings_args(args)?,
            TOOL_CREATE_SCHEDULED_TASK => validate_create_scheduled_task_args(args)?,
            _ => return Err(unknown_tool_error(tool_name)),
        };

        let command = AppControlCommand {
            action,
            payload_json: serde_json::to_string(&payload).map_err(|error| {
                Error::new(
                    Status::GenericFailure,
                    format!("Failed to serialize app control payload: {error}"),
                )
            })?,
        };

        let promise = on_app_control
            .call_async_catch(command)
            .await
            .map_err(|error| {
                Error::new(
                    Status::GenericFailure,
                    format!("Failed to dispatch app control command to Electron: {error}"),
                )
            })?;
        let result_json = promise.await.map_err(|error| {
            Error::new(
                Status::GenericFailure,
                format!("App control command failed: {error}"),
            )
        })?;

        let result: Value = serde_json::from_str(&result_json).map_err(|error| {
            Error::new(
                Status::GenericFailure,
                format!("App control returned invalid JSON: {error}"),
            )
        })?;

        Ok(result)
    }
}

impl McpService for AppControlService {
    fn id(&self) -> &str {
        SERVER_ID
    }

    fn tools(&self) -> Vec<McpTool> {
        vec![
            McpTool {
                server_id: SERVER_ID.to_string(),
                name: TOOL_CREATE_MEMO.to_string(),
                description: "Create a new memo (note) in the Snow App memo panel. The memo content supports plain text. Returns the created memo record.".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "content": {
                            "type": "string",
                            "description": "The text content for the new memo."
                        }
                    },
                    "required": ["content"]
                }),
            },
            McpTool {
                server_id: SERVER_ID.to_string(),
                name: TOOL_SET_MODE.to_string(),
                description: "Enable or disable Plan Mode or Goal Mode in the Snow App. Plan Mode makes the agent plan before executing. Goal Mode enables autonomous long-running execution with a token budget. The two modes are mutually exclusive.".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "mode": {
                            "type": "string",
                            "enum": ["plan", "goal"],
                            "description": "Which mode to toggle: \"plan\" for Plan Mode, \"goal\" for Goal Mode."
                        },
                        "enabled": {
                            "type": "boolean",
                            "description": "true to enable the mode, false to disable it."
                        }
                    },
                    "required": ["mode", "enabled"]
                }),
            },
            McpTool {
                server_id: SERVER_ID.to_string(),
                name: TOOL_OPEN_SETTINGS.to_string(),
                description: "Open a specific settings page in the Snow App UI. Available pages: api-settings, proxy-browser-settings, codebase-settings, system-prompt-settings, custom-headers-settings, mcp-settings, skills-settings, sub-agent-settings, sensitive-command-settings, hooks-settings, theme-settings, terminal-settings, keyboard-shortcuts-settings, privacy-settings, usage-settings, system-logs.".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "page": {
                            "type": "string",
                            "enum": [
                                "api-settings",
                                "proxy-browser-settings",
                                "codebase-settings",
                                "system-prompt-settings",
                                "custom-headers-settings",
                                "mcp-settings",
                                "skills-settings",
                                "sub-agent-settings",
                                "sensitive-command-settings",
                                "hooks-settings",
                                "theme-settings",
                                "terminal-settings",
                                "keyboard-shortcuts-settings",
                                "privacy-settings",
                                "usage-settings",
                                "system-logs"
                            ],
                            "description": "The settings page identifier to open."
                        }
                    },
                    "required": ["page"]
                }),
            },
            McpTool {
                server_id: SERVER_ID.to_string(),
                name: TOOL_CREATE_SCHEDULED_TASK.to_string(),
                description: "Create a new scheduled task in the Snow App. Tasks only exist while the Snow App process is running and are cleared on exit. When a task fires, its prompt is sent to the AI Loop (a new chat conversation is created and auto-sent), giving the task access to all tools. A task is either \"once\" (executes a single time at a chosen start time) or \"recurring\" (repeats either at a fixed interval or every day at a fixed time).".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "name": {
                            "type": "string",
                            "description": "A human-readable name for the task."
                        },
                        "prompt": {
                            "type": "string",
                            "description": "The prompt sent to the AI Loop on each execution. The task runs with access to all tools."
                        },
                        "schedule": {
                            "type": "object",
                            "description": "When the task runs.",
                            "properties": {
                                "type": {
                                    "type": "string",
                                    "enum": ["once", "recurring"],
                                    "description": "\"once\" = execute a single time at executeAt; \"recurring\" = repeat."
                                },
                                "executeAt": {
                                    "type": "string",
                                    "description": "ISO 8601 timestamp (UTC) for the single execution. Required when type is \"once\"."
                                },
                                "mode": {
                                    "type": "string",
                                    "enum": ["interval", "daily"],
                                    "description": "Recurring mode: \"interval\" = every intervalMs; \"daily\" = every day at hour:minute. Required when type is \"recurring\"."
                                },
                                "intervalMs": {
                                    "type": "number",
                                    "description": "Milliseconds between executions. Required when mode is \"interval\". Minimum 60000 (1 minute)."
                                },
                                "hour": {
                                    "type": "integer",
                                    "description": "Hour of day (0-23) for a daily schedule. Required when mode is \"daily\"."
                                },
                                "minute": {
                                    "type": "integer",
                                    "description": "Minute of hour (0-59) for a daily schedule. Required when mode is \"daily\"."
                                }
                            },
                            "required": ["type"]
                        }
                    },
                    "required": ["name", "prompt", "schedule"]
                }),
            },
        ]
    }

    fn execute(&self, tool_name: &str, _args: &Value) -> napi::Result<Value> {
        match tool_name {
            TOOL_CREATE_MEMO | TOOL_SET_MODE | TOOL_OPEN_SETTINGS | TOOL_CREATE_SCHEDULED_TASK => Err(Error::new(
                Status::GenericFailure,
                format!(
                    "{SERVER_ID}-{tool_name} must be executed through the asynchronous Electron app control bridge"
                ),
            )),
            _ => Err(unknown_tool_error(tool_name)),
        }
    }
}

fn validate_create_memo_args(args: &Value) -> napi::Result<(String, Value)> {
    let content = args
        .get("content")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            Error::new(
                Status::InvalidArg,
                "content is required and must be a non-empty string for createMemo".to_string(),
            )
        })?;

    Ok(("create_memo".to_string(), json!({ "content": content })))
}

fn validate_set_mode_args(args: &Value) -> napi::Result<(String, Value)> {
    let mode = args
        .get("mode")
        .and_then(Value::as_str)
        .map(str::trim)
        .ok_or_else(|| {
            Error::new(
                Status::InvalidArg,
                "mode is required for setMode (\"plan\" or \"goal\")".to_string(),
            )
        })?;

    if mode != "plan" && mode != "goal" {
        return Err(Error::new(
            Status::InvalidArg,
            format!("mode must be \"plan\" or \"goal\", received \"{mode}\""),
        ));
    }

    let enabled = args.get("enabled").and_then(Value::as_bool).ok_or_else(|| {
        Error::new(
            Status::InvalidArg,
            "enabled is required and must be a boolean for setMode".to_string(),
        )
    })?;

    Ok(("set_mode".to_string(), json!({ "mode": mode, "enabled": enabled })))
}

const VALID_SETTINGS_PAGES: &[&str] = &[
    "api-settings",
    "proxy-browser-settings",
    "codebase-settings",
    "system-prompt-settings",
    "custom-headers-settings",
    "mcp-settings",
    "skills-settings",
    "sub-agent-settings",
    "sensitive-command-settings",
    "hooks-settings",
    "theme-settings",
    "terminal-settings",
    "keyboard-shortcuts-settings",
    "privacy-settings",
    "usage-settings",
    "system-logs",
];

fn validate_open_settings_args(args: &Value) -> napi::Result<(String, Value)> {
    let page = args
        .get("page")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            Error::new(
                Status::InvalidArg,
                "page is required for openSettings".to_string(),
            )
        })?;

    if !VALID_SETTINGS_PAGES.contains(&page) {
        return Err(Error::new(
            Status::InvalidArg,
            format!(
                "Unknown settings page: \"{page}\". Valid pages: [{}]",
                VALID_SETTINGS_PAGES.join(", ")
            ),
        ));
    }

    Ok(("open_settings".to_string(), json!({ "page": page })))
}

/// Minimum interval (1 minute) for interval-mode recurring tasks.
const MIN_SCHEDULED_INTERVAL_MS: i64 = 60_000;

fn validate_create_scheduled_task_args(args: &Value) -> napi::Result<(String, Value)> {
    let name = args
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            Error::new(
                Status::InvalidArg,
                "name is required and must be a non-empty string for createScheduledTask"
                    .to_string(),
            )
        })?;

    let prompt = args
        .get("prompt")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            Error::new(
                Status::InvalidArg,
                "prompt is required and must be a non-empty string for createScheduledTask"
                    .to_string(),
            )
        })?;

    let schedule = args
        .get("schedule")
        .and_then(Value::as_object)
        .ok_or_else(|| {
            Error::new(
                Status::InvalidArg,
                "schedule is required and must be an object for createScheduledTask".to_string(),
            )
        })?;

    let schedule_type = schedule
        .get("type")
        .and_then(Value::as_str)
        .map(str::trim)
        .ok_or_else(|| {
            Error::new(
                Status::InvalidArg,
                "schedule.type is required (\"once\" or \"recurring\")".to_string(),
            )
        })?;

    // Build a normalized schedule payload. We pass the (validated) schedule
    // through verbatim so the renderer-side store can apply the same validation
    // (single source of truth). We still validate here so the model gets an
    // actionable error before dispatching to Electron.
    let mut normalized = serde_json::Map::new();
    normalized.insert("type".to_string(), json!(schedule_type));

    match schedule_type {
        "once" => {
            let execute_at = schedule
                .get("executeAt")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .ok_or_else(|| {
                    Error::new(
                        Status::InvalidArg,
                        "schedule.executeAt is required (ISO 8601 timestamp) when type is \"once\""
                            .to_string(),
                    )
                })?;
            // Best-effort ISO 8601 timestamp sanity check; the renderer
            // validates strictly (it must support the same formats JS Date.parse does).
            if chrono::DateTime::parse_from_rfc3339(execute_at).is_err() {
                return Err(Error::new(
                    Status::InvalidArg,
                    format!(
                        "schedule.executeAt is not a valid ISO 8601 timestamp: \"{execute_at}\""
                    ),
                ));
            }
            normalized.insert("executeAt".to_string(), json!(execute_at));
        }
        "recurring" => {
            let mode = schedule
                .get("mode")
                .and_then(Value::as_str)
                .map(str::trim)
                .ok_or_else(|| {
                    Error::new(
                        Status::InvalidArg,
                        "schedule.mode is required (\"interval\" or \"daily\") when type is \"recurring\"".to_string(),
                    )
                })?;
            normalized.insert("mode".to_string(), json!(mode));

            match mode {
                "interval" => {
                    let interval_ms = schedule
                        .get("intervalMs")
                        .and_then(Value::as_i64)
                        .ok_or_else(|| {
                            Error::new(
                                Status::InvalidArg,
                                "schedule.intervalMs is required (number, ms) when mode is \"interval\"".to_string(),
                            )
                        })?;
                    if interval_ms < MIN_SCHEDULED_INTERVAL_MS {
                        return Err(Error::new(
                            Status::InvalidArg,
                            format!(
                                "schedule.intervalMs must be >= {MIN_SCHEDULED_INTERVAL_MS} (1 minute), received {interval_ms}"
                            ),
                        ));
                    }
                    normalized.insert("intervalMs".to_string(), json!(interval_ms));
                }
                "daily" => {
                    let hour = schedule
                        .get("hour")
                        .and_then(Value::as_i64)
                        .ok_or_else(|| {
                            Error::new(
                                Status::InvalidArg,
                                "schedule.hour is required (0-23) when mode is \"daily\""
                                    .to_string(),
                            )
                        })?;
                    let minute = schedule
                        .get("minute")
                        .and_then(Value::as_i64)
                        .ok_or_else(|| {
                            Error::new(
                                Status::InvalidArg,
                                "schedule.minute is required (0-59) when mode is \"daily\""
                                    .to_string(),
                            )
                        })?;
                    if !(0..=23).contains(&hour) {
                        return Err(Error::new(
                            Status::InvalidArg,
                            format!("schedule.hour must be 0-23, received {hour}"),
                        ));
                    }
                    if !(0..=59).contains(&minute) {
                        return Err(Error::new(
                            Status::InvalidArg,
                            format!("schedule.minute must be 0-59, received {minute}"),
                        ));
                    }
                    normalized.insert("hour".to_string(), json!(hour));
                    normalized.insert("minute".to_string(), json!(minute));
                }
                other => {
                    return Err(Error::new(
                        Status::InvalidArg,
                        format!(
                            "schedule.mode must be \"interval\" or \"daily\", received \"{other}\""
                        ),
                    ));
                }
            }
        }
        other => {
            return Err(Error::new(
                Status::InvalidArg,
                format!(
                    "schedule.type must be \"once\" or \"recurring\", received \"{other}\""
                ),
            ));
        }
    }

    Ok((
        "create_scheduled_task".to_string(),
        json!({
            "name": name,
            "prompt": prompt,
            "schedule": Value::Object(normalized),
        }),
    ))
}

fn unknown_tool_error(tool_name: &str) -> Error {
    Error::new(
        Status::GenericFailure,
        format!(
            "Unknown tool: \"{tool_name}\" for MCP server \"{SERVER_ID}\". Available tools: [{SERVER_ID}-{TOOL_CREATE_MEMO}, {SERVER_ID}-{TOOL_SET_MODE}, {SERVER_ID}-{TOOL_OPEN_SETTINGS}, {SERVER_ID}-{TOOL_CREATE_SCHEDULED_TASK}]"
        ),
    )
}
