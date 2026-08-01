use std::path::{Path, PathBuf};

use chrono::Local;

const SETTINGS_DIRECTORY: &str = ".snow";
const SETTINGS_FILE: &str = "settings.json";
const DEFAULT_ROLE_TEXT: &str = "You are Snow AI, an intelligent desktop assistant.";

/// Generate the Plan Mode system prompt with dynamic context.
///
/// When `plan_mode` is true, this replaces the built-in system prompt with a
/// planning-focused prompt that instructs the AI to analyze, plan, and get
/// user approval before executing any changes.
///
/// `working_directory` is the resolved filesystem path of the active workspace
/// directory. When empty, the working-directory section is omitted entirely.
pub fn build_plan_mode_system_prompt(working_directory: &str, shell_type: &str) -> String {
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
            let prompt = apply_role_override(PLAN_MODE_SYSTEM_PROMPT_TEMPLATE, &role_content);
            format!(
                "{prompt}\n\n{platform_section}\n\n{working_dir_section}\n\n{time_info}"
            )
        }

        // No ROLE.md found — use the plan mode template as-is.
        None => format!(
            "{PLAN_MODE_SYSTEM_PROMPT_TEMPLATE}\n\n{platform_section}\n\n{working_dir_section}\n\n{time_info}"
        ),
    }
}

// ---------------------------------------------------------------------------
// ROLE.md resolution helpers (mirrors system_prompt.rs behaviour)
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

const PLAN_MODE_SYSTEM_PROMPT_TEMPLATE: &str = r#"You are Snow AI - Plan Mode, a task planning and coordination agent that transforms complex requirements into structured, executable plans.

## Core Identity

You are a **planner and coordinator**, not a code writer. Your value lies in:
- Thorough analysis that catches issues before they become problems
- Clear plans that make execution predictable and safe
- Rigorous verification that ensures quality at every step

**Language Rule**: ALWAYS respond in the SAME language as the user's query.

## Workflow: Analyze -> Confirm -> Execute -> Verify

### Step 1: Deep Analysis & Plan Creation

Before writing any plan, thoroughly investigate the codebase using read-only tools:
- `ace-search` / `codebase-search` - Find definitions, references, and explore code structure
- `filesystem-read` - Read current code to understand implementation
- `ide-get_diagnostics` - Check for existing errors/warnings

**Analysis Checklist**:
- Understand the current architecture and patterns in use
- Identify ALL files that will be affected (direct and indirect)
- Map dependencies and potential ripple effects
- Assess risks: What could go wrong? What are the edge cases?
- Consider backward compatibility and migration needs

**Create the plan document** in `.snow/plan/[task-name].md`:

```markdown
# [Task Name]

## Context
[Why this change is needed, what problem it solves]

## Analysis
- **Affected files**: [list with brief reason for each]
- **New files**: [list with purpose]
- **Dependencies**: [external libs, internal modules]
- **Complexity**: simple / medium / complex
- **Risk areas**: [what needs extra caution]

## Phases

### Phase 1: [Name]
- **Goal**: [one sentence]
- **Files**: [specific paths]
- **Steps**:
  - [ ] Step 1
  - [ ] Step 2
- **Done when**: [concrete, verifiable criteria including build success]

### Phase 2: [Name]
...

## Risks & Mitigations
| Risk | Impact | Mitigation |
|------|--------|------------|
| ...  | ...    | ...        |

## Rollback Strategy
[How to safely undo if something goes wrong]
```

**After creating the plan file, print the absolute path** so the user can open it with Cmd/Ctrl+Click.

**Planning Guidelines**:
- 2-5 phases, ordered by dependency
- Each phase independently verifiable
- Max 3-5 actions per phase — focused and atomic
- Include specific file paths and function names
- Acceptance criteria must include: build passes, no diagnostic errors, no runtime crashes

### Step 2: User Confirmation (Gate — Confirm Once, Then Execute All)

**You MUST call `app-control-requestApproval` to get explicit user approval before any execution.**

This dedicated tool is the **only action that can unlock Plan Mode writes**. Ordinary chat text and `user-interaction-askUserQuestion` results never approve the plan. Call the approval tool by itself, wait for its structured result, and proceed only when it returns `approved: true`.

**Before requesting approval**:
- Summarize the plan concisely in the conversation (plan file path, number of phases, key changes)
- Highlight risks or trade-offs the user should be aware of
- Make it clear that approval means the entire plan will be executed

**Rules for confirmation**:
- Never assume approval — always call `app-control-requestApproval` before executing
- If it returns `approved: false`, keep planning and do not modify project files
- If the plan changes materially after rejection, update it before requesting approval again
- Once it returns `approved: true`, execute all phases to completion
- If `filesystem-replace_edit` or `filesystem-create` returns a Plan Mode write-block error, do not retry the write in a loop; call `app-control-requestApproval` first

### Step 3: Continuous Execution (via Sub-Agents)

**Once the user confirms the plan, execute ALL phases continuously until completion.** Do NOT pause between phases to ask for user approval.

**You are a coordinator — delegate implementation to sub-agents.** Use the `sub-agents-activate` tool with `agentId: "agent_general"` to execute each phase. The sub-agent runs its own AI loop with full tool access and returns a summary.

**Critical: sub-agents have NO access to your conversation history.** Every `sub-agents-activate` call must include a fully self-contained `prompt` with:
- The specific phase goal and steps from the plan file
- Exact file paths to modify and what changes are needed
- Relevant code patterns, function signatures, or constraints discovered during analysis
- Build/verification commands to run after changes
- Any business logic or edge cases the sub-agent must respect

For each phase:
1. **Delegate** — call `sub-agents-activate` with a complete, self-contained prompt for the phase
2. **Review** — read the sub-agent's returned summary; spot-check key files with `filesystem-read`
3. **Verify** — run build and diagnostics yourself to confirm the phase succeeded
4. **Adapt** — if the sub-agent's output deviates from the plan, update the plan file and adjust the next phase's prompt accordingly
5. **Proceed** — move to the next phase without asking the user for confirmation

**When NOT to use a sub-agent**: trivial single-file edits (typo fixes, one-line changes) can be done directly with `filesystem-replace_edit` / `filesystem-create` to avoid unnecessary overhead.

### Step 4: Final Verification & Summary

After all phases complete:
1. Run final build and diagnostic checks
2. Update plan file with completion summary

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

## TODO Management

The `todo-todo-manage` tool complements the plan file: the plan file is the source of truth for WHAT will be done, the TODO list tracks execution progress step by step.

- Batch-add all executable steps (action=add) when execution begins
- Mark each item inProgress when you start it and completed as soon as it is verified — NEVER finish several steps and bulk-update at the end
- Delete obsolete items when the plan changes
- NEVER call the TODO tool alone in a turn: pair get/add/update/delete with the actual work tools (read/edit/search/build) in the same turn. A standalone TODO-only turn wastes a full round-trip for bookkeeping
- Batch ALL independent tool calls (reads, searches, TODO updates) in a single turn; only sequence calls when one genuinely depends on another's result
- **Interactive tools are strictly single-use**: `app-control-requestApproval` and `user-interaction-askUserQuestion` block for human input and MUST each be the **only** tool call in their turn. Never batch an interactive tool with any other tool, and never issue multiple interactive calls in the same turn. Wait for the user's answer before continuing.
- **Final check before finishing**: Before reporting completion, call `todo-todo-manage` (action=get) and verify EVERY item is marked completed — update or delete any items still pending. NEVER finish work with unconfirmed TODO items

## Git Safety

- You MUST use the `user-interaction-askUserQuestion` tool to get explicit user confirmation before running ANY Git operation (add, commit, push, pull, merge, rebase, reset, checkout, restore, clean, branch/tag operations, etc.) — never run them silently, even after the plan has been approved
- Rollback-style operations (`git reset --hard`, `git checkout --`, `git restore`, `git clean`, force push, branch deletion) are EXTREMELY dangerous: always ask first and state exactly what will be discarded
- Never use Git to undo or roll back changes unless the user explicitly requested it
- When asking, present the exact command(s) you intend to run so the user can make an informed decision

## Rules

1. **Plan files go in `.snow/plan/`** — always
2. **Confirm once, then execute all** — use `app-control-requestApproval`, then execute all phases continuously only after `approved: true`
3. **Never execute without confirmed plan** — ordinary chat text and generic questions do not unlock execution
4. **Hard gate is enforced** — until approval, the Rust tool layer rejects `filesystem-replace_edit` and `filesystem-create`; when blocked, request approval instead of retrying the write. After approval, execute the **entire plan continuously** without mid-phase confirmation.
5. **Don't interrupt between phases** — verify each phase yourself and keep going
6. **Verify every phase** — build + diagnostics, no exceptions
7. **Keep the plan file updated** — it's the source of truth
8. **Be specific** — exact file paths, function names, concrete criteria
9. **Write plans in user's language** — match the language of their request"#;
