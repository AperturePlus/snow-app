use std::path::{Path, PathBuf};

use chrono::Local;

const SETTINGS_DIRECTORY: &str = ".snow";
const SETTINGS_FILE: &str = "settings.json";
const DEFAULT_ROLE_TEXT: &str = "You are Snow AI, an intelligent desktop assistant.";

/// Generate the Goal Mode system prompt with dynamic context.
///
/// When `goal_mode` is true, this replaces the built-in system prompt with a
/// goal-driven prompt that instructs the AI to work autonomously toward a
/// defined objective across multiple turns until verifiable completion.
///
/// `working_directory` is the resolved filesystem path of the active workspace
/// directory. When empty, the working-directory section is omitted entirely.
pub fn build_goal_mode_system_prompt(working_directory: &str, shell_type: &str, token_budget: i64) -> String {
    let time_info = get_current_time_info();
    let working_dir_section = get_working_directory_section(working_directory);
    let platform_section = get_platform_section(shell_type);
    let budget_section = get_budget_section(token_budget);

    match read_active_role(working_directory) {
        // Override mode: role content replaces the entire template.
        Some((role_content, true)) => format!(
            "{role_content}\n\n{platform_section}\n\n{working_dir_section}\n\n{time_info}{budget_section}"
        ),

        // Normal mode: role content replaces the default role text.
        Some((role_content, false)) => {
            let prompt = apply_role_override(GOAL_MODE_SYSTEM_PROMPT_TEMPLATE, &role_content);
            format!(
                "{prompt}\n\n{platform_section}\n\n{working_dir_section}\n\n{time_info}{budget_section}"
            )
        }

        // No ROLE.md found — use the goal mode template as-is.
        None => format!(
            "{GOAL_MODE_SYSTEM_PROMPT_TEMPLATE}\n\n{platform_section}\n\n{working_dir_section}\n\n{time_info}{budget_section}"
        ),
    }
}

// ---------------------------------------------------------------------------
// ROLE.md resolution helpers (mirrors system_prompt.rs behaviours)
// ---------------------------------------------------------------------------

fn try_read_role_file(path: &Path) -> Option<String> {
    std::fs::read_to_string(path)
        .ok()
        .map(|content| content.trim().to_string())
        .filter(|content| !content.is_empty())
}

fn read_role_settings(settings_path: &Path) -> (Option<String>, Vec<String>) {
    let content = match std::fs::read_to_string(settings_path) {
        Ok(c) => c,
        Err(_) => return (None, Vec::new()),
    };
    let json: serde_json::Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(_) => return (None, Vec::new()),
    };

    let role = match json.get("role") {
        Some(r) => r,
        None => return (None, Vec::new()),
    };

    let active_role_id = role
        .get("activeRoleId")
        .and_then(serde_json::Value::as_str)
        .map(|s| s.to_string());

    let override_role_ids = role
        .get("overrideRoleIds")
        .and_then(serde_json::Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    (active_role_id, override_role_ids)
}

fn resolve_role_file_name(active_role_id: &Option<String>) -> String {
    match active_role_id {
        Some(id) if !id.is_empty() && id != "active" => format!("ROLE-{id}.md"),
        _ => "ROLE.md".to_string(),
    }
}

fn is_override_role(active_role_id: &Option<String>, override_role_ids: &[String]) -> bool {
    let resolved_id = match active_role_id {
        Some(id) if !id.is_empty() && id != "active" => id.as_str(),
        _ => "active",
    };
    override_role_ids.iter().any(|id| id == resolved_id)
}

fn read_active_role(working_directory: &str) -> Option<(String, bool)> {
    if !working_directory.trim().is_empty() && !working_directory.starts_with("ssh://") {
        let project_dir = Path::new(working_directory);
        let settings_path = project_dir.join(SETTINGS_DIRECTORY).join(SETTINGS_FILE);
        let (active_role_id, override_role_ids) = read_role_settings(&settings_path);
        let role_file = project_dir.join(resolve_role_file_name(&active_role_id));

        if let Some(content) = try_read_role_file(&role_file) {
            let is_override = is_override_role(&active_role_id, &override_role_ids);
            return Some((content, is_override));
        }
    }

    if let Some(home_dir) = dirs_next::home_dir() {
        let global_dir: PathBuf = home_dir.join(SETTINGS_DIRECTORY);
        let settings_path = global_dir.join(SETTINGS_FILE);
        let (active_role_id, override_role_ids) = read_role_settings(&settings_path);
        let role_file = global_dir.join(resolve_role_file_name(&active_role_id));

        if let Some(content) = try_read_role_file(&role_file) {
            let is_override = is_override_role(&active_role_id, &override_role_ids);
            return Some((content, is_override));
        }
    }

    None
}

fn apply_role_override(prompt: &str, role_content: &str) -> String {
    let override_block = format!(
        "These are the rules emphasized by the user, which must be adhered to 100%:\n{role_content}"
    );
    prompt.replacen(DEFAULT_ROLE_TEXT, &override_block, 1)
}

fn get_budget_section(token_budget: i64) -> String {
    if token_budget <= 0 {
        return String::new();
    }
    format!(
        "\n\n## Token Budget\n\n\
         You have a total token budget of **{}** tokens for this goal.\n\
         Track your cumulative token usage across all turns. When you estimate you have consumed \
         approximately 80% of the budget, begin wrapping up: finish the current iteration, \
         summarize progress, list remaining work, and provide clear next steps.\n\
         When the budget is exhausted, stop all substantive work immediately and report:\n\
         - What was accomplished\n\
         - What remains incomplete\n\
         - Recommended next steps to continue\n\n\
         Do NOT mark the goal as complete when stopped by budget — only mark complete when \
         all success criteria are verified with evidence.",
        token_budget
    )
}

// ---------------------------------------------------------------------------
// Dynamic context helpers
// ---------------------------------------------------------------------------

fn get_current_time_info() -> String {
    format!("Current Date: {}", Local::now().format("%Y-%m-%d"))
}

fn get_working_directory_section(working_directory: &str) -> String {
    if working_directory.trim().is_empty() {
        return String::new();
    }

    format!(
        "## Working Directory\n\nThe user's current working directory is:\n`{working_directory}`\n\nAll file operations should be relative to this directory unless explicitly specified otherwise."
    )
}

/// Build the platform-specific command requirements section based on the
/// user's configured terminal shell type.
///
/// Bash commands always execute in the shell resolved from the terminal
/// settings' `shellPath`; when unconfigured, the local OS default terminal is
/// used instead (see `resolve_shell_and_args`). The guidance therefore follows
/// `shell_type` when known, and falls back to the local OS otherwise —
/// claiming POSIX on a Windows machine would mislead the AI into using Unix
/// commands that fail in PowerShell/CMD.
fn get_platform_section(shell_type: &str) -> String {
    let (env_label, shell_label, guidance) = match shell_type {
        "cmd" => (
            "Windows",
            "CMD (cmd.exe)",
            "- Use: Windows CMD built-in commands (`del`, `copy`, `move`, `type`, `dir`, etc.)\n\
             - Shell operators: `&`, `&&`, `||`\n\
             - Path separator: `\\`\n\
             - No PowerShell cmdlets — use CMD equivalents (e.g. `del` not `Remove-Item`)",
        ),
        "gitbash" => (
            "Windows (Git Bash)",
            "Git Bash (MSYS2/MinGW)",
            "- Use: Unix/POSIX commands (`rm`, `cp`, `mv`, `cat`, `ls`, `grep`, etc.)\n\
             - Shell operators: `;`, `&&`, `||`, `|`\n\
             - Path separator: `/` (forward slash)\n\
             - Supports bash scripting syntax",
        ),
        "wsl" => (
            "WSL (Linux)",
            "WSL (Windows Subsystem for Linux)",
            "- Use: Linux commands (`rm`, `cp`, `mv`, `cat`, `ls`, `grep`, etc.)\n\
             - Shell operators: `;`, `&&`, `||`, `|`\n\
             - Path separator: `/` (forward slash)\n\
             - Windows drives accessible via `/mnt/c/`, `/mnt/d/`, etc.\n\
             - Supports full bash/zsh scripting syntax",
        ),
        "powershell" => (
            "Windows",
            "PowerShell",
            "- Use: PowerShell cmdlets (`Remove-Item`, `Copy-Item`, `Move-Item`, `Get-Content`, etc.)\n\
             - Shell operators: `;`, `&&`, `||` (PowerShell 7+)\n\
             - Path separator: `\\` or `/` (both work)\n\
             - No Unix commands — use PowerShell cmdlet equivalents (e.g. `Get-ChildItem` not `ls`, `Get-Content` not `cat`, `Remove-Item` not `rm`)",
        ),
        // Unconfigured/unknown shell type: commands still execute in the local
        // OS default terminal (see resolve_shell_and_args), so fall back to the
        // local OS instead of claiming POSIX — on Windows that would mislead
        // the AI into using Unix commands that do not exist in PowerShell/CMD.
        _ if cfg!(target_os = "windows") => (
            "Windows",
            "Default Windows shell (PowerShell or CMD)",
            "- Use: PowerShell cmdlets (`Get-ChildItem`, `Get-Content`, `Remove-Item`, `Copy-Item`, etc.) or CMD built-ins (`dir`, `type`, `del`, `copy`)\n\
             - Shell operators: `;` (PowerShell) or `&`, `&&`, `||` (CMD)\n\
             - Path separator: `\\`\n\
             - No Unix commands — use the Windows equivalents",
        ),
        _ => (
            "POSIX",
            "POSIX Shell",
            "- Use: `rm`, `cp`, `mv`, `grep`, `cat`, `ls`, `mkdir`, `rmdir`, `find`, `sed`, `awk`\n\
             - Supports: `&&`, `||`, pipes `|`, redirection `>`, `<`, `>>`",
        ),
    };

    format!(
        "## Platform-Specific Command Requirements\n\n\
         **Current Environment: {env_label}**\n\
         **Active Shell: {shell_label}**\n\n\
         {guidance}"
    )
}

const GOAL_MODE_SYSTEM_PROMPT_TEMPLATE: &str = r#"You are Snow AI - Goal Mode, a persistent objective-driven agent that works autonomously toward a defined outcome across multiple turns until verifiable completion.

## Core Identity

You are a **goal-driven autonomous worker**. Your value lies in:
- Persistent focus on the objective until it is verifiably achieved
- Evidence-based progress assessment after every iteration
- Self-correction through continuous test-verify-adapt cycles
- Clear reporting when blocked, rather than guessing or looping indefinitely

**Language Rule**: ALWAYS respond in the SAME language as the user's query.

## Operating Loop: Investigate -> Plan -> Act -> Verify -> Iterate

### Phase 1: Investigate & Understand
Before taking action, thoroughly understand the current state:
- Read relevant code, configs, and documentation
- Identify the gap between current state and desired outcome
- Map dependencies, constraints, and risk areas

### Phase 2: Plan the Next Iteration
Based on investigation, decide the smallest meaningful step forward:
- Choose specific files, functions, or components to modify
- Define what evidence will prove this step succeeded
- Identify what must NOT break (non-regression constraints)

### Phase 3: Act
Execute the planned changes:
- Write code, create files, modify configurations
- Keep changes focused and atomic per iteration
- Preserve existing functionality unless explicitly changing it

### Phase 4: Verify with Evidence
After acting, gather concrete evidence of progress:
- Run builds, tests, lints, or type checks
- Check diagnostic output for errors
- Compare actual results against expected outcomes
- A goal is NOT complete based on confidence alone - it requires verifiable proof

### Phase 5: Review & Decide
Based on evidence, choose the next action:
- **Goal met**: All success criteria verified with evidence -> Report completion with proof
- **Progress made, not done**: Continue to next iteration automatically
- **Blocked**: Document what was tried, what failed, what evidence was gathered, and what input is needed -> Report to user and wait
- **Regression detected**: Revert or fix the regression before continuing

## Critical Rules

1. **Evidence-based completion** - Never declare a goal done without verifiable proof (passing tests, successful builds, correct output)
2. **Non-regression** - Constraints define what must stay intact. Violating constraints invalidates progress
3. **Explicit blocking** - When stuck, report: attempted paths, gathered evidence, identified blockers, and required next inputs
4. **Continuous execution** - Do not pause between iterations to ask for permission. Keep working until done or genuinely blocked
5. **Atomic iterations** - Each iteration should be a focused, verifiable step. Avoid large untested batches
6. **Self-audit** - Before declaring completion, re-verify all success criteria from scratch

## TODO Management

Use the `todo-todo-manage` tool to track multi-step goals:
- Add all planned steps when the goal is defined
- Mark each step completed as soon as it is verified
- Update the plan when iterations reveal new information
- NEVER batch-update TODO status at the end
- Follow the language used by the user when adding a todo
- **Final check before finishing** - Before declaring the goal complete, call `todo-todo-manage` (action=get) and confirm EVERY item is marked completed; update or delete anything still pending. NEVER finish the goal with unconfirmed TODO items


## Git Safety

- You MUST use the `user-interaction-askUserQuestion` tool to get explicit user confirmation before running ANY Git operation
- Rollback-style operations are EXTREMELY dangerous: always ask first
- Never use Git to undo changes unless the user explicitly requested it

## Math Formula Rendering

The chat UI renders LaTeX math via KaTeX with dollar delimiters ONLY:
- **Inline formulas**: wrap in single dollar signs, e.g. `$E = mc^2$`
- **Display (block) formulas**: wrap in double dollar signs on their own lines, e.g.

```
$$
\int_{0}^{\infty} e^{-x^2} dx = \frac{\sqrt{\pi}}{2}
$$
```

- NEVER use `\(...\)` or `\[...\]` delimiters — they are NOT rendered
- Use only KaTeX-supported LaTeX commands; unsupported commands render as raw source
- When a formula contains currency-like `$` text nearby, prefer code spans for literal dollar amounts to avoid ambiguity"#;
