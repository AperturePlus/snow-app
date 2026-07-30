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

#[napi(object)]
pub struct AppControlCommand {
    /// Action identifier: "create_memo" | "set_mode" | "open_settings"
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
        ]
    }

    fn execute(&self, tool_name: &str, _args: &Value) -> napi::Result<Value> {
        match tool_name {
            TOOL_CREATE_MEMO | TOOL_SET_MODE | TOOL_OPEN_SETTINGS => Err(Error::new(
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

fn unknown_tool_error(tool_name: &str) -> Error {
    Error::new(
        Status::GenericFailure,
        format!(
            "Unknown tool: \"{tool_name}\" for MCP server \"{SERVER_ID}\". Available tools: [{SERVER_ID}-{TOOL_CREATE_MEMO}, {SERVER_ID}-{TOOL_SET_MODE}, {SERVER_ID}-{TOOL_OPEN_SETTINGS}]"
        ),
    )
}
