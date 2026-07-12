use std::path::{Path, PathBuf};

use chrono::{Local, Offset};
use serde_json::Value;

const SETTINGS_DIRECTORY: &str = ".snow";
const SETTINGS_FILE: &str = "settings.json";
const DEFAULT_ROLE_TEXT: &str = "You are Snow AI, an intelligent desktop assistant.";

/// Generate the built-in system prompt with dynamic context (current time, working directory, platform info).
///
/// `working_directory` is the resolved filesystem path of the active workspace directory.
/// When empty, the working-directory section is omitted entirely.
///
/// ROLE.md injection (mirrors snow-cli behaviour):
/// - Project scope ROLE.md > Global scope ROLE.md > default prompt.
/// - If the active role is marked as "override", its content **replaces** the entire
///   system prompt template; only platform/working-dir/time sections are appended.
/// - Otherwise the ROLE.md content replaces the default role text inside the template.
pub fn build_system_prompt(working_directory: &str) -> String {
    let time_info = get_current_time_info();
    let working_dir_section = get_working_directory_section(working_directory);
    let platform_section = get_platform_section();

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
    let now = Local::now();
    format!(
        "## Current Time\n\n{}\n\n**Timezone:** {}",
        now.format("%Y-%m-%d %H:%M:%S"),
        now.offset().fix().to_string()
    )
}

fn get_working_directory_section(working_directory: &str) -> String {
    if working_directory.trim().is_empty() {
        return String::new();
    }

    format!(
        "## Working Directory\n\nThe user's current working directory is:\n`{working_directory}`\n\nAll file operations should be relative to this directory unless explicitly specified otherwise."
    )
}

fn get_platform_section() -> String {
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;

    let platform_name = match os {
        "macos" => "macOS",
        "linux" => "Linux",
        "windows" => "Windows",
        other => other,
    };

    let shell_info = if os == "windows" {
        "- Use: PowerShell cmdlets (`Remove-Item`, `Copy-Item`, `Move-Item`, `Get-Content`, etc.)\n- Shell operators: `;`, `&&`, `||` (PowerShell 7+)"
    } else {
        "- Use: `rm`, `cp`, `mv`, `grep`, `cat`, `ls`, `mkdir`, `rmdir`, `find`, `sed`, `awk`\n- Supports: `&&`, `||`, pipes `|`, redirection `>`, `<`, `>>`"
    };

    format!(
        "## Platform-Specific Command Requirements\n\n**Current Environment: {platform_name} ({arch})**\n\n{shell_info}"
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

## Quality Assurance

1. After modifications are completed, compile the project to ensure there are no compilation errors
2. Fix any errors immediately
3. Never leave broken code"#;
