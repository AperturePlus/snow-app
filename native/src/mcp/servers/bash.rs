use std::collections::HashMap;
use std::process::Stdio;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use crate::exports::terminal::detect_default_terminal;

use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;
use regex::Regex;
use serde_json::{json, Value};
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::Command;

use super::super::service::McpService;
use super::super::tools::McpTool;

pub struct BashService;

#[napi(object)]
pub struct BashStreamChunk {
    pub stream: String,
    pub data: String,
}

pub type BashStreamCallback =
    ThreadsafeFunction<BashStreamChunk, Unknown<'static>, BashStreamChunk, Status, false>;

impl BashService {
    pub fn new() -> Self {
        BashService
    }
}

const SERVER_ID: &str = "bash";
const MAX_OUTPUT_LENGTH: usize = 10000;
const DEFAULT_TIMEOUT_MS: u64 = 30000;
const OUTPUT_TRUNCATED_MARKER: &str = "... (output truncated)";
const TERMINAL_SETTINGS_CODE: &str = "terminal_settings";
const SENSITIVE_AUTHORIZATION_TTL: Duration = Duration::from_secs(60);

struct SensitiveCommandAuthorization {
    command: String,
    expires_at: Instant,
}

static SENSITIVE_COMMAND_AUTHORIZATIONS: OnceLock<
    tokio::sync::Mutex<HashMap<String, SensitiveCommandAuthorization>>,
> = OnceLock::new();

fn sensitive_command_authorizations(
) -> &'static tokio::sync::Mutex<HashMap<String, SensitiveCommandAuthorization>> {
    SENSITIVE_COMMAND_AUTHORIZATIONS.get_or_init(|| tokio::sync::Mutex::new(HashMap::new()))
}

pub async fn authorize_sensitive_command(command: String, token: String) -> napi::Result<()> {
    if command.trim().is_empty() || token.trim().is_empty() {
        return Err(Error::new(
            Status::InvalidArg,
            "Sensitive command and authorization token are required".to_string(),
        ));
    }

    let now = Instant::now();
    let mut authorizations = sensitive_command_authorizations().lock().await;
    authorizations.retain(|_, authorization| authorization.expires_at > now);
    authorizations.insert(
        token,
        SensitiveCommandAuthorization {
            command,
            expires_at: now + SENSITIVE_AUTHORIZATION_TTL,
        },
    );
    Ok(())
}

async fn consume_sensitive_command_authorization(
    command: &str,
    token: Option<&str>,
) -> bool {
    let Some(token) = token.filter(|value| !value.is_empty()) else {
        return false;
    };

    let now = Instant::now();
    let mut authorizations = sensitive_command_authorizations().lock().await;
    authorizations.retain(|_, authorization| authorization.expires_at > now);
    authorizations
        .remove(token)
        .map(|authorization| authorization.command == command && authorization.expires_at > now)
        .unwrap_or(false)
}

#[derive(serde::Deserialize)]
struct TerminalSettingsJson {
    #[serde(rename = "shellPath")]
    shell_path: String,
}

impl McpService for BashService {
    fn id(&self) -> &str {
        SERVER_ID
    }

    fn tools(&self) -> Vec<McpTool> {
        vec![McpTool {
            server_id: SERVER_ID.to_string(),
            name: "terminal-execute".to_string(),
            description: "Execute terminal commands like npm, git, build scripts, etc. BEST PRACTICE: For file modifications, prefer filesystem tools first. Primary use cases: (1) Running build/test/lint scripts, (2) Version control operations, (3) Package management, (4) System utilities.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "Terminal command to execute directly."
                    },
                    "workingDirectory": {
                        "type": "string",
                        "description": "REQUIRED: Working directory where the command should be executed. Can be a local path (e.g., \"D:/projects/myapp\")."
                    },
                    "timeout": {
                        "type": "number",
                        "description": "Timeout in milliseconds (default: 30000)",
                        "default": 30000
                    },
                    "isInteractive": {
                        "type": "boolean",
                        "description": "Set to true if the command requires user input (e.g., password prompts, y/n confirmations, interactive installers). Default: false.",
                        "default": false
                    }
                },
                "required": ["command", "workingDirectory"]
            }),
        }]
    }

    fn execute(&self, tool_name: &str, _args: &Value) -> napi::Result<Value> {
        match tool_name {
            "terminal-execute" => Err(Error::new(
                Status::GenericFailure,
                "The Bash tool must be executed through the asynchronous streaming executor"
                    .to_string(),
            )),
            _ => Err(Error::new(
                Status::GenericFailure,
                format!(
                    "Unknown tool: \"{}\" for MCP server \"bash\". Available tools: [mcp__bash__terminal-execute]",
                    tool_name
                ),
            )),
        }
    }
}

impl BashService {
    pub async fn execute_terminal_stream(
        &self,
        args: &Value,
        project_id: Option<&str>,
        sensitive_authorization_token: Option<&str>,
        on_chunk: BashStreamCallback,
    ) -> napi::Result<Value> {
        let command = args
            .get("command")
            .and_then(Value::as_str)
            .ok_or_else(|| Error::new(Status::InvalidArg, "command is required".to_string()))?
            .to_string();

        let working_directory = args
            .get("workingDirectory")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                Error::new(
                    Status::InvalidArg,
                    "workingDirectory is required".to_string(),
                )
            })?
            .to_string();

        let timeout = args
            .get("timeout")
            .and_then(Value::as_u64)
            .unwrap_or(DEFAULT_TIMEOUT_MS);
        let executed_at = chrono::Local::now().to_rfc3339();

        if is_dangerous_command(&command) {
            return Err(Error::new(
                Status::GenericFailure,
                format!(
                    "Dangerous command detected and blocked: {}",
                    command.chars().take(50).collect::<String>()
                ),
            ));
        }

        let self_destruct = is_self_destructive_command(&command);
        if self_destruct.is_self_destructive {
            return Err(Error::new(
                Status::GenericFailure,
                format!(
                    "[SELF-PROTECTION] Command blocked: {}. {}",
                    self_destruct.reason, self_destruct.suggestion
                ),
            ));
        }

        // Sensitive commands require a short-lived, one-time authorization
        // token issued after explicit user confirmation. The token travels
        // outside the model-controlled tool arguments and is bound to this
        // exact command.
        let sensitive_matches = check_sensitive_commands(&command, project_id).await;
        if !sensitive_matches.is_empty()
            && !consume_sensitive_command_authorization(
                &command,
                sensitive_authorization_token,
            )
            .await
        {
            let error_payload = json!({
                "error": "SENSITIVE_COMMAND_DETECTED",
                "message": "Command matched a sensitive command rule and requires confirmation",
                "command": command,
                "matches": sensitive_matches,
            });
            return Err(Error::new(
                Status::GenericFailure,
                error_payload.to_string(),
            ));
        }

        let shell_path = load_terminal_shell_path().await?;
        let (shell, shell_args) = resolve_shell_and_args(&shell_path, &command).await?;

        let mut process = Command::new(&shell);
        process
            .args(&shell_args)
            .current_dir(&working_directory)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .env("LANG", "en_US.UTF-8")
            .env("LC_ALL", "en_US.UTF-8");

        #[cfg(target_os = "windows")]
        {
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            process.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = process.spawn().map_err(|error| {
            Error::new(
                Status::GenericFailure,
                format!("Failed to spawn process: {error}"),
            )
        })?;

        let callback = Arc::new(on_chunk);
        let stdout_task = child.stdout.take().map(|stdout| {
            tokio::spawn(read_stream(stdout, "stdout", Arc::clone(&callback)))
        });
        let stderr_task = child.stderr.take().map(|stderr| {
            tokio::spawn(read_stream(stderr, "stderr", Arc::clone(&callback)))
        });

        let wait_result = match tokio::time::timeout(
            Duration::from_millis(timeout),
            child.wait(),
        )
        .await
        {
            Ok(Ok(status)) => ProcessWaitResult::Completed(status.code().unwrap_or(1)),
            Ok(Err(error)) => {
                let _ = child.kill().await;
                let _ = child.wait().await;
                ProcessWaitResult::Failed(error.to_string())
            }
            Err(_) => {
                let _ = child.kill().await;
                let _ = child.wait().await;
                ProcessWaitResult::TimedOut
            }
        };

        let stdout = await_stream_task(stdout_task).await;
        let stderr = await_stream_task(stderr_task).await;

        match wait_result {
            ProcessWaitResult::Completed(exit_code) => Ok(json!({
                "stdout": stdout,
                "stderr": stderr,
                "exitCode": exit_code,
                "command": command,
                "executedAt": executed_at
            })),
            ProcessWaitResult::TimedOut => Err(Error::new(
                Status::GenericFailure,
                format!("Command timed out after {timeout}ms: {command}"),
            )),
            ProcessWaitResult::Failed(error) => Err(Error::new(
                Status::GenericFailure,
                format!("Failed to wait for process: {error}"),
            )),
        }
    }
}

async fn load_terminal_shell_path() -> napi::Result<String> {
    let setting_json = tokio::task::spawn_blocking(|| {
        crate::storage::get_system_setting_value(TERMINAL_SETTINGS_CODE.to_string())
    })
    .await
    .map_err(|error| {
        Error::new(
            Status::GenericFailure,
            format!("Failed to read terminal settings: {error}"),
        )
    })?
    .map_err(|error| {
        Error::new(
            Status::GenericFailure,
            format!("Failed to read terminal settings: {error}"),
        )
    })?;

    match setting_json {
        Some(json) => {
            let settings: TerminalSettingsJson = serde_json::from_str(&json).map_err(|error| {
                Error::new(
                    Status::GenericFailure,
                    format!("Failed to parse terminal settings: {error}"),
                )
            })?;
            Ok(settings.shell_path)
        }
        None => Ok(String::new()),
    }
}

async fn resolve_shell_and_args(
    shell_path: &str,
    command: &str,
) -> napi::Result<(String, Vec<String>)> {
    if shell_path.is_empty() {
        if let Some(detected) = detect_default_terminal().await? {
            return build_shell_args(&detected.path, &detected.family, command);
        }
        return fallback_shell_args(command);
    }

    let family = detect_shell_family(shell_path);
    build_shell_args(shell_path, &family, command)
}

fn detect_shell_family(shell_path: &str) -> String {
    let lower = shell_path.to_lowercase();
    let file_name = std::path::Path::new(shell_path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("")
        .to_lowercase();

    if file_name.contains("pwsh")
        || file_name.contains("powershell")
        || lower.contains("pwsh")
        || lower.contains("powershell")
    {
        "powershell".to_string()
    } else if file_name.contains("cmd") || lower.contains("cmd.exe") {
        "cmd".to_string()
    } else if file_name.contains("wsl") || lower.contains("wsl.exe") {
        "wsl".to_string()
    } else {
        "posix".to_string()
    }
}

fn build_shell_args(
    shell: &str,
    family: &str,
    command: &str,
) -> napi::Result<(String, Vec<String>)> {
    match family {
        "powershell" => {
            let utf8_command = format!(
                "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; {}",
                command
            );
            Ok((
                shell.to_string(),
                vec![
                    "-NoProfile".to_string(),
                    "-Command".to_string(),
                    utf8_command,
                ],
            ))
        }
        "cmd" => {
            let utf8_command = format!("chcp 65001>nul && {}", command);
            Ok((shell.to_string(), vec!["/C".to_string(), utf8_command]))
        }
        "wsl" => Ok((
            shell.to_string(),
            vec![
                "-e".to_string(),
                "bash".to_string(),
                "-c".to_string(),
                command.to_string(),
            ],
        )),
        _ => Ok((
            shell.to_string(),
            vec!["-c".to_string(), command.to_string()],
        )),
    }
}

fn fallback_shell_args(command: &str) -> napi::Result<(String, Vec<String>)> {
    if cfg!(target_os = "windows") {
        let utf8_command = format!("chcp 65001>nul && {}", command);
        Ok(("cmd".to_string(), vec!["/C".to_string(), utf8_command]))
    } else {
        Ok(("sh".to_string(), vec!["-c".to_string(), command.to_string()]))
    }
}

enum ProcessWaitResult {
    Completed(i32),
    TimedOut,
    Failed(String),
}

async fn await_stream_task(
    task: Option<tokio::task::JoinHandle<String>>,
) -> String {
    match task {
        Some(task) => task.await.unwrap_or_default(),
        None => String::new(),
    }
}

async fn read_stream<R>(
    mut reader: R,
    stream: &'static str,
    on_chunk: Arc<BashStreamCallback>,
) -> String
where
    R: AsyncRead + Unpin,
{
    let mut output = Vec::new();
    let mut buffer = [0_u8; 4096];
    let mut pending_utf8 = Vec::new();
    let mut was_truncated = false;

    loop {
        let read = match reader.read(&mut buffer).await {
            Ok(0) | Err(_) => break,
            Ok(read) => read,
        };

        let remaining = MAX_OUTPUT_LENGTH.saturating_sub(output.len());
        let accepted = remaining.min(read);
        if accepted > 0 {
            output.extend_from_slice(&buffer[..accepted]);
            pending_utf8.extend_from_slice(&buffer[..accepted]);
            emit_complete_utf8_chunks(&on_chunk, stream, &mut pending_utf8);
        }

        if accepted < read && !was_truncated {
            was_truncated = true;
            emit_stream_chunk(
                &on_chunk,
                stream,
                OUTPUT_TRUNCATED_MARKER.to_string(),
            );
        }
    }

    if !pending_utf8.is_empty() {
        emit_stream_chunk(
            &on_chunk,
            stream,
            String::from_utf8_lossy(&pending_utf8).into_owned(),
        );
    }

    let mut text = String::from_utf8_lossy(&output).into_owned();
    if was_truncated {
        text.push_str(OUTPUT_TRUNCATED_MARKER);
    }
    text
}

fn emit_complete_utf8_chunks(
    on_chunk: &BashStreamCallback,
    stream: &str,
    pending: &mut Vec<u8>,
) {
    loop {
        match std::str::from_utf8(pending) {
            Ok(text) => {
                emit_stream_chunk(on_chunk, stream, text.to_string());
                pending.clear();
                return;
            }
            Err(error) => {
                let valid_up_to = error.valid_up_to();
                if valid_up_to > 0 {
                    let text = String::from_utf8_lossy(&pending[..valid_up_to]).into_owned();
                    emit_stream_chunk(on_chunk, stream, text);
                    pending.drain(..valid_up_to);
                    continue;
                }

                if error.error_len().is_none() {
                    return;
                }

                let invalid_len = error.error_len().unwrap_or(1);
                let invalid = String::from_utf8_lossy(&pending[..invalid_len]).into_owned();
                emit_stream_chunk(on_chunk, stream, invalid);
                pending.drain(..invalid_len);
            }
        }
    }
}

fn emit_stream_chunk(
    on_chunk: &BashStreamCallback,
    stream: &str,
    data: String,
) {
    if data.is_empty() {
        return;
    }

    on_chunk.call(
        BashStreamChunk {
            stream: stream.to_string(),
            data,
        },
        ThreadsafeFunctionCallMode::NonBlocking,
    );
}

// ============================================================================
// Security utilities (ported from snow-cli security.utils.ts)
// ============================================================================

/// Check if a command matches any user-configured sensitive command rules.
/// Uses spawn_blocking to avoid blocking the async runtime with SQLite I/O.
/// Returns a JSON array of matched rules (command_id, pattern, description).
async fn check_sensitive_commands(command: &str, project_id: Option<&str>) -> Vec<Value> {
    let command_owned = command.to_string();
    let project_id_owned = project_id.map(str::to_string);
    match tokio::task::spawn_blocking(move || {
        crate::storage::check_sensitive_command_match(command_owned, project_id_owned)
    })
    .await
    {
        Ok(Ok(matches)) => matches
            .into_iter()
            .map(|m| {
                json!({
                    "commandId": m.command_id,
                    "pattern": m.pattern,
                    "description": m.description,
                })
            })
            .collect(),
        Ok(Err(_)) | Err(_) => Vec::new(),
    }
}

/// Dangerous command patterns that should be blocked
fn is_dangerous_command(command: &str) -> bool {
    let patterns: [&str; 4] = [
        r"(?i)rm\s+-rf\s+/[^/\s]*", // rm -rf / or /path
        r"(?i)>\s*/dev/sda",         // writing to disk devices
        r"(?i)mkfs",                 // format filesystem
        r"(?i)dd\s+if=",             // disk operations
    ];

    patterns
        .iter()
        .any(|p| Regex::new(p).map(|r| r.is_match(command)).unwrap_or(false))
}

/// Self-protection: detect commands that would kill the app's own process.
struct SelfDestructCheck {
    is_self_destructive: bool,
    reason: String,
    suggestion: String,
}

/// Returns a SelfDestructCheck indicating whether the command is self-destructive.
///
/// Since this runs inside the Electron app process, any command that terminates
/// Electron processes by name (e.g. killall, pkill, taskkill) will also kill the app.
fn is_self_destructive_command(command: &str) -> SelfDestructCheck {
    let lower = command.to_lowercase();
    let app_pid = std::process::id();

    // Windows CMD: taskkill targeting electron.exe
    if regex_matches(r"(?i)\btaskkill\b", command)
        && regex_matches(r"(?i)\belectron(\.exe)?\b", command)
    {
        return SelfDestructCheck {
            is_self_destructive: true,
            reason: "Command would terminate electron.exe processes, including this app itself"
                .to_string(),
            suggestion: format!(
                "This app is running as electron.exe (PID: {}). Use \"taskkill /PID <target_pid>\" for specific processes, excluding PID {}.",
                app_pid, app_pid
            ),
        };
    }

    // Unix: killall electron
    if regex_matches(r"(?i)\bkillall\s+(-\w+\s+)*electron\b", command) {
        return SelfDestructCheck {
            is_self_destructive: true,
            reason: "killall electron would terminate ALL Electron processes, including this app"
                .to_string(),
            suggestion: format!(
                "Use \"kill <specific_pid>\" to target individual processes, excluding PID {}.",
                app_pid
            ),
        };
    }

    // Unix: pkill electron / pkill -f electron
    if regex_matches(r"(?i)\bpkill\s+(-\w+\s+)*electron\b", command) {
        return SelfDestructCheck {
            is_self_destructive: true,
            reason: "pkill electron would terminate Electron processes, including this app"
                .to_string(),
            suggestion: format!(
                "Use \"kill <specific_pid>\" to target individual processes, excluding PID {}.",
                app_pid
            ),
        };
    }

    // Also protect against killing node processes
    if regex_matches(r"(?i)\bkillall\s+(-\w+\s+)*node\b", command) {
        return SelfDestructCheck {
            is_self_destructive: true,
            reason: "killall node would terminate ALL Node.js processes, including this app"
                .to_string(),
            suggestion: format!(
                "Use \"kill <specific_pid>\" to target individual processes, excluding PID {}.",
                app_pid
            ),
        };
    }

    if regex_matches(r"(?i)\bpkill\s+(-\w+\s+)*node\b", command) {
        return SelfDestructCheck {
            is_self_destructive: true,
            reason: "pkill node would terminate Node.js processes, including this app".to_string(),
            suggestion: format!(
                "Use \"kill <specific_pid>\" to target individual processes, excluding PID {}.",
                app_pid
            ),
        };
    }

    // Windows: Stop-Process targeting node/electron
    if lower.contains("stop-process")
        && (regex_matches(r"(?i)\bnode\b", command)
            || regex_matches(r"(?i)\belectron\b", command))
    {
        return SelfDestructCheck {
            is_self_destructive: true,
            reason: "Command would terminate Node.js/Electron processes, including this app itself"
                .to_string(),
            suggestion: format!(
                "This app (PID: {}) may be affected. Add a PID exclusion filter.",
                app_pid
            ),
        };
    }

    // Directly targeting the app's own PID
    let pid_str = app_pid.to_string();

    // Check for "kill <pid>" or "kill -9 <pid>" patterns
    let kill_pattern = format!(r"\bkill\s+(-\d+\s+)*{}\b", pid_str);
    let kill9_pattern = format!(r"\bkill\s+-9\s+{}\b", pid_str);
    let stop_process_pattern = format!(r"(?i)\bStop-Process\s+.*-Id\s+{}\b", pid_str);
    let taskkill_pattern = format!(r"(?i)\btaskkill\b.*/PID\s+{}\b", pid_str);

    let pid_patterns = [kill_pattern, kill9_pattern, stop_process_pattern, taskkill_pattern];

    for pattern in &pid_patterns {
        if regex_matches(pattern, command) {
            return SelfDestructCheck {
                is_self_destructive: true,
                reason: format!(
                    "Command directly targets this app process (PID: {})",
                    app_pid
                ),
                suggestion: format!(
                    "PID {} is the Snow App process. Killing it will terminate the current session.",
                    app_pid
                ),
            };
        }
    }

    let _ = lower; // suppress unused warning
    SelfDestructCheck {
        is_self_destructive: false,
        reason: String::new(),
        suggestion: String::new(),
    }
}

/// Helper: compile and test a regex pattern against a string
fn regex_matches(pattern: &str, text: &str) -> bool {
    Regex::new(pattern)
        .map(|r| r.is_match(text))
        .unwrap_or(false)
}


