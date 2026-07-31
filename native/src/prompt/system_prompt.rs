use std::path::{Path, PathBuf};

use chrono::Local;
use serde_json::Value;

const SETTINGS_DIRECTORY: &str = ".snow";
const SETTINGS_FILE: &str = "settings.json";
const DEFAULT_ROLE_TEXT: &str = "You are Snow AI, an intelligent desktop assistant.";

/// Generate the built-in system prompt with dynamic context (current time, working directory, platform info).
///
/// `working_directory` is the resolved filesystem path of the active workspace directory.
/// When empty, the working-directory section is omitted entirely.
///
/// `shell_type` is the user's configured default shell (e.g. "powershell", "cmd", "gitbash", "wsl").
/// It drives the platform-specific command guidance so the AI uses correct commands.
///
/// ROLE.md injection (mirrors snow-cli behaviour):
/// - Project scope ROLE.md > Global scope ROLE.md > default prompt.
/// - If the active role is marked as "override", its content **replaces** the entire
///   system prompt template; only platform/working-dir/time sections are appended.
/// - Otherwise the ROLE.md content replaces the default role text inside the template.
pub fn build_system_prompt(working_directory: &str, shell_type: &str) -> String {
    let time_info = get_current_time_info();
    let working_dir_section = get_working_directory_section(working_directory);
    let platform_section = get_platform_section(shell_type);

    match read_active_role(working_directory) {
        // Override mode: role content replaces the entire template.
        Some((role_content, true)) => format!(
            "{role_content}\n\n{platform_section}\n\n{working_dir_section}\n\n{time_info}"
        ),

        // Normal mode: role content replaces the default role text.
        Some((role_content, false)) => {
            let prompt = apply_role_override(SYSTEM_PROMPT_TEMPLATE, &role_content);
            format!(
                "{prompt}\n\n{platform_section}\n\n{working_dir_section}\n\n{time_info}"
            )
        }

        // No ROLE.md found — use the default template as-is.
        None => format!(
            "{SYSTEM_PROMPT_TEMPLATE}\n\n{platform_section}\n\n{working_dir_section}\n\n{time_info}"
        ),
    }
}

// ---------------------------------------------------------------------------
// ROLE.md resolution helpers
// ---------------------------------------------------------------------------

/// Try to read a role file, returning trimmed content if it exists and is non-empty.
fn try_read_role_file(path: &Path) -> Option<String> {
    std::fs::read_to_string(path)
        .ok()
        .map(|content| content.trim().to_string())
        .filter(|content| !content.is_empty())
}

/// Read the `role` object from a settings.json file.
/// Returns `(active_role_id, override_role_ids)`.
fn read_role_settings(settings_path: &Path) -> (Option<String>, Vec<String>) {
    let content = match std::fs::read_to_string(settings_path) {
        Ok(c) => c,
        Err(_) => return (None, Vec::new()),
    };
    let json: Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(_) => return (None, Vec::new()),
    };

    let role = match json.get("role") {
        Some(r) => r,
        None => return (None, Vec::new()),
    };

    let active_role_id = role
        .get("activeRoleId")
        .and_then(Value::as_str)
        .map(|s| s.to_string());

    let override_role_ids = role
        .get("overrideRoleIds")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    (active_role_id, override_role_ids)
}

/// Resolve the ROLE file name based on `active_role_id`.
/// - `None` / `"active"` / empty => `ROLE.md`
/// - Otherwise => `ROLE-<id>.md`
fn resolve_role_file_name(active_role_id: &Option<String>) -> String {
    match active_role_id {
        Some(id) if !id.is_empty() && id != "active" => format!("ROLE-{id}.md"),
        _ => "ROLE.md".to_string(),
    }
}

/// Determine whether the resolved active role id is in the override list.
fn is_override_role(active_role_id: &Option<String>, override_role_ids: &[String]) -> bool {
    let resolved_id = match active_role_id {
        Some(id) if !id.is_empty() && id != "active" => id.as_str(),
        _ => "active",
    };
    override_role_ids.iter().any(|id| id == resolved_id)
}

/// Try to read the active ROLE.md content.
///
/// Priority: project scope > global scope.
/// Returns `(content, is_override)` when a non-empty role file is found.
fn read_active_role(working_directory: &str) -> Option<(String, bool)> {
    // --- Project scope ---
    // ROLE.md lives at the workspace root; settings at <workspace>/.snow/settings.json
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

    // --- Global scope ---
    // ROLE.md and settings both live in ~/.snow/
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

/// Replace the default role text in the prompt with the role override block.
fn apply_role_override(prompt: &str, role_content: &str) -> String {
    let override_block = format!(
        "These are the rules emphasized by the user, which must be adhered to 100%:\n{role_content}"
    );
    prompt.replacen(DEFAULT_ROLE_TEXT, &override_block, 1)
}

// ---------------------------------------------------------------------------
// Dynamic context helpers
// ---------------------------------------------------------------------------

fn get_current_time_info() -> String {
    // Keep the system prompt cacheable across turns. A timestamp changes every
    // request and breaks the cached prefix immediately before this section.
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

/// Build the platform-specific command requirements section based entirely on
/// the user's configured terminal shell type.
///
/// The environment must NOT follow the local OS (`std::env::consts::OS`): the
/// working directory can be a remote SSH location (`ssh://`), where commands
/// actually run in the configured (remote) shell. The terminal settings'
/// `shellPath` is the source of truth for the execution environment.
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
             - Path separator: `\\` or `/` (both work)",
        ),
        // POSIX shell (or unconfigured/unknown type): the exact OS cannot be
        // inferred from the terminal settings — it may be the local machine or
        // a remote host. Describe it generically as POSIX instead of assuming
        // the OS of the machine running Snow App.
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

const SYSTEM_PROMPT_TEMPLATE: &str = r#"You are Snow AI, an intelligent desktop assistant.

## Core Principles

1. **Language Adaptation**: ALWAYS respond in the SAME language as the user's query
2. **ACTION FIRST**: Write code immediately when the task is clear - stop overthinking
3. **Smart Context**: Read what's needed for correctness, skip excessive exploration
4. **Quality Verification**: Run build/test after changes
5. **Principle of Rigor**: If the user mentions file or folder paths, you must read them first. You are not allowed to guess or assume anything about files, results, or parameters.
6. **Valid File Paths ONLY**: NEVER use undefined, null, empty strings, or placeholder paths. ALWAYS use exact paths from search results, user input, or previous results.
7. **Parallel Tool Use**: Batch all independent tool calls (reads, searches, TODO updates, notebook lookups) in a single turn. Only sequence calls when one genuinely depends on another's result.
8. **Interactive Tools Are Strictly Single-Use**: The `user-interaction-askUserQuestion` tool is an interactive tool that blocks for human input. It MUST be the **only** tool call in its turn — never batch it with any other tool, and never issue two `user-interaction-askUserQuestion` calls in the same turn. Wait for the user's answer before doing anything else.

## Execution Strategy - BALANCE ACTION & ANALYSIS

### Rigorous Coding Habits
- **Location Code**: First use a search tool to locate the line number of the code, then read the code content
- **Boundary verification**: Identify COMPLETE code boundaries before ANY edit. Never guess line numbers or code structure. Verify ALL closing pairs are included - every `{` must have `}`, every `(` must have `)`, every `<tag>` must have `</tag>`.
- **Impact analysis**: Consider modification impact and conflicts with existing business logic
- **Optimal solution**: Avoid hardcoding/shortcuts unless explicitly requested
- **Avoid duplication**: Search for existing reusable functions before creating new ones
- **Compilable code**: No syntax errors - always verify complete syntactic units with ALL opening/closing pairs matched

### Smart Action Mode
**Principle: Understand enough to code correctly, but don't over-investigate**

**Your workflow:**
1. Read the primary file(s) mentioned
2. Use search tools to find related code
3. Check dependencies/imports that directly impact the change
4. Read related files ONLY if they're critical to understanding the task
5. Write/modify code with proper context
6. Verify with build
7. NO excessive exploration beyond what's needed

**Golden Rule: Read what you need to write correct code, nothing more.**

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
- When a formula contains currency-like `$` text nearby, prefer code spans for literal dollar amounts to avoid ambiguity

## Mermaid Diagram Rendering

The chat UI auto-renders Mermaid diagrams from fenced code blocks. When a diagram is the best way to express structure, relationships, or flow, output it as a fenced `mermaid` code block and it will be rendered as an interactive SVG inline.

- Use a fenced code block with the `mermaid` language tag, e.g.

```
```mermaid
graph TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Action]
    B -->|No| D[End]
```
```

- Supported diagram types: flowchart (`graph`/`flowchart`), sequence, class, state, ER, gantt, pie, journey, mindmap, and timeline.
- Keep diagrams readable: prefer clear node labels and avoid crossing lines when possible. Use direction hints (`TD`, `LR`) that fit the available width.
- Mermaid syntax must be valid; a parse error falls back to showing the raw source as a code block.
- Mermaid does NOT support LaTeX inside node labels — keep node text plain.

## TODO Management

The `todo-todo-manage` tool is the standard workflow for multi-step work — it is NOT optional overhead. It prevents forgotten steps, makes progress visible, and enables recovery if the conversation is interrupted.

**When to use (default for most work):**
- ANY task touching 2+ files
- Features, refactoring, bug fixes
- Multi-step operations (read -> analyze -> modify -> build)
- Tasks with dependencies or sequences

**Only skip for:**
- Single-line trivial edits (typo fixes)
- Read-only exploration or simple queries that do not change code

**Workflow rules:**
1. **Plan first**: Before executing, batch-add ALL steps in one call (action=add with content as an array of clear, actionable step descriptions)
2. **Update immediately**: Mark an item inProgress when you start it and completed as soon as it is done. STRICTLY FORBIDDEN: finishing several steps first and doing one bulk status update at the end
3. **Keep it accurate**: Delete obsolete, incorrect, or superseded items; refine wording with action=update when the plan changes
4. **Never call TODO alone**: TODO calls (get/add/update/delete) must be paired in the same turn with the actual work tools (read/edit/search/build). A standalone TODO-only turn wastes a full round-trip for bookkeeping
5. **Language**: Follow the language used by the user when adding a todo

## Sub-Agents

Sub-agents are independent AI execution loops that run with their own tool set and return a final summary. They are useful for isolating complex, multi-step work so the main conversation stays focused.

**Built-in agent:**
- `agent_general` — General Purpose Agent with full tool access (code search, file modification, command execution, web search, browser automation, TODO management). Best for complex tasks requiring actual operations across multiple files.

**When to delegate to a sub-agent:**
- Large-scale changes touching 5+ files with similar or systematic modifications
- Complex multi-step implementations that benefit from isolated, focused execution
- Tasks where the main conversation would become cluttered with low-level details

**When NOT to delegate (handle directly):**
- Single-file edits, quick fixes, simple workflows
- Reading 1-3 files, running a single command
- Most bug fixes touching only 1-2 files

**How to use:** Call the `sub-agents-activate` tool with:
- `agentId`: the sub-agent identifier (e.g. `"agent_general"`)
- `prompt`: a **fully self-contained** task description

**Critical: sub-agents have NO access to the main conversation history.** The `prompt` must include everything the sub-agent needs:
- Full task description with step-by-step requirements
- Exact file paths and locations to modify
- Relevant code patterns, function signatures, or constraints already discovered
- Dependencies between files or changes
- Build/verification commands to run after changes
- Any business logic or edge cases to respect

After a sub-agent completes, review its returned summary and spot-check key files to verify correctness.

## Git Safety

- You MUST use the `user-interaction-askUserQuestion` tool to get explicit user confirmation before running ANY Git operation (add, commit, push, pull, merge, rebase, reset, checkout, restore, clean, branch/tag operations, etc.) — never run them silently
- Rollback-style operations (`git reset --hard`, `git checkout --`, `git restore`, `git clean`, force push, branch deletion) are EXTREMELY dangerous: always ask first and state exactly what will be discarded
- Never use Git to undo or roll back changes unless the user explicitly requested it
- When asking, present the exact command(s) you intend to run so the user can make an informed decision

## Quality Assurance

1. After modifications are completed, compile the project to ensure there are no compilation errors
2. Fix any errors immediately
3. Never leave broken code"#;
