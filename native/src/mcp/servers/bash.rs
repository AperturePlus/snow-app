use std::io::Read;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use napi::bindgen_prelude::*;
use regex::Regex;
use serde_json::{json, Value};

use super::super::service::McpService;
use super::super::tools::McpTool;

pub struct BashService;

impl BashService {
    pub fn new() -> Self {
        BashService
    }
}

const SERVER_ID: &str = "bash";
const MAX_OUTPUT_LENGTH: usize = 10000;
const DEFAULT_TIMEOUT_MS: u64 = 30000;
const POLL_INTERVAL_MS: u64 = 50;

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
                    },
                    "enableAiSummary": {
                        "type": "boolean",
                        "description": "REQUIRED: Whether to summarize and clean command output with AI before returning tool result. Set true when output may contain noisy or low-value information. Default: false.",
                        "default": false
                    }
                },
                "required": ["command", "workingDirectory", "enableAiSummary"]
            }),
        }]
    }

    fn execute(&self, tool_name: &str, args: &Value) -> napi::Result<Value> {
        match tool_name {
            "terminal-execute" => self.execute_terminal(args),
            _ => Err(Error::new(
                Status::GenericFailure,
                format!("Unknown tool: {}", tool_name),
            )),
        }
    }
}

impl BashService {
    fn execute_terminal(&self, args: &Value) -> napi::Result<Value> {
        let command = args
            .get("command")
            .and_then(|v| v.as_str())
            .ok_or_else(|| Error::new(Status::InvalidArg, "command is required".to_string()))?;

        let working_directory = args
            .get("workingDirectory")
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                Error::new(
                    Status::InvalidArg,
                    "workingDirectory is required".to_string(),
                )
            })?;

        let timeout = args
            .get("timeout")
            .and_then(|v| v.as_u64())
            .unwrap_or(DEFAULT_TIMEOUT_MS);

        let executed_at = chrono::Local::now().to_rfc3339();

        // Security check: reject potentially dangerous commands
        if is_dangerous_command(command) {
            return Err(Error::new(
                Status::GenericFailure,
                format!(
                    "Dangerous command detected and blocked: {}",
                    &command[..command.len().min(50)]
                ),
            ));
        }

        // Self-protection: reject commands that would kill the app's own process
        let self_destruct = is_self_destructive_command(command);
        if self_destruct.is_self_destructive {
            return Err(Error::new(
                Status::GenericFailure,
                format!(
                    "[SELF-PROTECTION] Command blocked: {}. {}",
                    self_destruct.reason, self_destruct.suggestion
                ),
            ));
        }

        let is_windows = cfg!(target_os = "windows");

        let (shell, shell_args) = if is_windows {
            // On Windows, use cmd with UTF-8 codepage
            let utf8_command = format!("chcp 65001>nul && {}", command);
            ("cmd".to_string(), vec!["/C".to_string(), utf8_command])
        } else {
            // On Unix, use sh
            ("sh".to_string(), vec!["-c".to_string(), command.to_string()])
        };

        let mut cmd = Command::new(&shell);
        cmd.args(&shell_args)
            .current_dir(working_directory)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env("LANG", "en_US.UTF-8")
            .env("LC_ALL", "en_US.UTF-8");

        // On Windows, prevent a console window from flashing on screen
        // when spawning processes from a GUI application.
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            // CREATE_NO_WINDOW flag (0x08000000) prevents the console window
            // from appearing and disappearing.
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = cmd.spawn()
            .map_err(|e| {
                Error::new(
                    Status::GenericFailure,
                    format!("Failed to spawn process: {}", e),
                )
            })?;

        // Poll for completion with timeout using try_wait()
        let deadline = Instant::now() + Duration::from_millis(timeout);
        let poll_interval = Duration::from_millis(POLL_INTERVAL_MS);

        loop {
            match child.try_wait() {
                Ok(Some(status)) => {
                    // Process finished
                    let stdout = read_stdout(&mut child);
                    let stderr = read_stderr(&mut child);
                    let exit_code = status.code().unwrap_or(1);

                    return Ok(json!({
                        "stdout": truncate_output(&stdout, MAX_OUTPUT_LENGTH),
                        "stderr": truncate_output(&stderr, MAX_OUTPUT_LENGTH),
                        "exitCode": exit_code,
                        "command": command,
                        "executedAt": executed_at
                    }));
                }
                Ok(None) => {
                    // Still running
                    if Instant::now() >= deadline {
                        // Timed out - kill the process
                        let _ = child.kill();
                        let _ = child.wait();
                        return Err(Error::new(
                            Status::GenericFailure,
                            format!("Command timed out after {}ms: {}", timeout, command),
                        ));
                    }
                    thread::sleep(poll_interval);
                }
                Err(e) => {
                    return Err(Error::new(
                        Status::GenericFailure,
                        format!("Failed to wait for process: {}", e),
                    ));
                }
            }
        }
    }
}

fn read_stdout(child: &mut std::process::Child) -> String {
    match child.stdout.take() {
        Some(mut s) => {
            let mut buf = String::new();
            let _ = s.read_to_string(&mut buf);
            buf
        }
        None => String::new(),
    }
}

fn read_stderr(child: &mut std::process::Child) -> String {
    match child.stderr.take() {
        Some(mut s) => {
            let mut buf = String::new();
            let _ = s.read_to_string(&mut buf);
            buf
        }
        None => String::new(),
    }
}

// ============================================================================
// Security utilities (ported from snow-cli security.utils.ts)
// ============================================================================

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

/// Truncate output if it exceeds maximum length
fn truncate_output(output: &str, max_length: usize) -> String {
    if output.is_empty() {
        return String::new();
    }
    if output.len() > max_length {
        format!("{}... (output truncated)", &output[..max_length])
    } else {
        output.to_string()
    }
}
