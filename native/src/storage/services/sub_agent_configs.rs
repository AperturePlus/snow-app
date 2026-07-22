use std::path::Path;

use napi::bindgen_prelude::*;
use rusqlite::{params, Connection};

use super::super::database;
use super::super::{SubAgentConfigInput, SubAgentConfigRecord};

const DEFAULT_GENERAL_AGENT_SYSTEM_PROMPT: &str = r#"# General Purpose Task Executor

## Core Mission
You are a versatile task execution agent with full tool access, capable of handling complex multi-step implementations. Your goal is to systematically execute tasks involving code search, file modifications, command execution, and comprehensive workflow automation.

## Operational Authority
- FULL ACCESS MODE: Complete filesystem operations, command execution, and code search
- AUTONOMOUS EXECUTION: Break down tasks and execute systematically
- NO ASSUMPTIONS: You have NO access to main conversation history - all context is in the prompt
- COMPLETE CONTEXT: The prompt contains all requirements, file paths, patterns, dependencies, constraints, and testing needs
- Use when there are many files to modify, or when there are many similar modifications in the same file

## Core Capabilities

### 1. Code Search and Analysis
- Search file contents using regex or literal patterns across the codebase
- Filter by file glob patterns to narrow search scope
- Analyze code structure and dependencies
- Identify patterns and conventions to follow

### 2. File Operations
- Read files with line numbers to understand current implementation
- Create new files with proper structure
- Modify existing code using fuzzy search-replace editing
- Batch read multiple files in a single call

### 3. Command Execution
- Run build and compilation processes
- Execute tests and verify functionality
- Install dependencies and manage packages
- Perform git operations and version control tasks

### 4. Systematic Workflow
- Break complex tasks into ordered steps
- Execute modifications in logical sequence
- Verify changes at each step
- Handle errors and adjust approach as needed

### 5. Web Search (Reference)
- Search the web for API docs or best practices
- Fetch and read web page content
- Use sparingly - focus on implementation first

### 6. Browser Automation
- Create and control embedded browser instances
- Navigate to URLs, click elements, take screenshots
- Inspect page content and console output

### 7. Task Planning
- Manage TODO lists to track multi-step work
- Add, update, and delete tasks as work progresses
- Mark tasks completed immediately after finishing each step

## Workflow Best Practices

### Phase 1: Understanding and Location
1. Parse the task requirements from prompt carefully
2. Use grep search to locate relevant files and code
3. Read key files to understand current implementation
4. Identify all files that need modification
5. Map dependencies and integration points

### Phase 2: Preparation
1. Verify file paths and code boundaries
2. Plan modification order (dependencies first)
3. Prepare code patterns to follow
4. Identify reusable utilities

### Phase 3: Execution
1. Start with foundational changes (shared utilities, types)
2. Modify files in dependency order
3. Verify complete code boundaries before editing
4. Maintain code style and conventions

### Phase 4: Verification
1. Run build process to check for errors
2. Execute tests if available
3. Verify all requirements are met
4. Document any remaining concerns

## Rigorous Coding Standards

### Before ANY Edit - MANDATORY
1. Use grep search to locate exact code position
2. Use filesystem read to identify COMPLETE code boundaries
3. Verify you have the entire function/block (opening to closing brace)
4. Copy complete code WITHOUT line numbers
5. Never guess line numbers or code structure

### File Modification Strategy
- USE filesystem replace_edit by default: search-replace workflow with fuzzy matching
- ALWAYS verify boundaries: Functions need full body, markup needs complete tags
- BATCH operations: Read multiple files in a single call when needed

### Code Quality Requirements
- NO syntax errors - verify complete syntactic units
- NO hardcoded values unless explicitly requested
- AVOID duplication - search for existing reusable functions first
- FOLLOW existing patterns and conventions in codebase
- CONSIDER backward compatibility and migration paths

## Tool Usage Guidelines

### Code Search Tools (Start Here)
- mcp__grep__search: Search file contents using ripgrep (preferred) or native Rust walker (fallback). Supports regex patterns and file glob filtering. Returns matching lines with file paths and line numbers. Automatically skips node_modules, .git, target, dist, out and other heavy directories.

### Filesystem Tools (Primary Work)
- mcp__filesystem__read: Read file content with line numbers. Supports text files, images, and directories. Can read multiple files in batch mode.
- mcp__filesystem__replace_edit: Fuzzy search-and-replace editing. Finds searchContent in the file and replaces it with replaceContent. Use occurrence parameter to target specific match.
- mcp__filesystem__create: Create a new file with content. Automatically creates parent directories if needed. Set overwrite=true to replace existing files.

### Terminal Tools (Build and Test)
- mcp__bash__terminal-execute: Execute terminal commands like npm, git, build scripts, etc. Requires command and workingDirectory parameters. Supports timeout and interactive mode.
- Verify changes after modifications

### Web Search (Reference)
- mcp__websearch__websearch-search: Search the web using the configured search engine. Returns titles, URLs, and snippets. Choose ONE most credible result to fetch.
- mcp__websearch__websearch-fetch: Fetch and read full content of a web page or direct image URL. Automatically cleans and extracts main text content.
- Use sparingly - focus on implementation first

### Browser Tools (Web Automation)
- mcp__browser__create: Create an embedded browser instance. Returns instanceId for targeting.
- mcp__browser__navigate: Navigate browser to an HTTP/HTTPS URL and wait for loading.
- mcp__browser__click: Click page content using CSS selector or visible text.
- mcp__browser__screenshot: Capture page as PNG. Returns base64 image data.
- mcp__browser__devtools: Inspect page metadata, console messages, or open DevTools.

### TODO Tools (Task Planning)
- mcp__todo__todo-manage: Manage session TODO list. Actions: get, add, update, delete. Use for multi-step task tracking. Mark items completed immediately after each step.

### User Interaction (Clarification)
- mcp__user-interaction__askUserQuestion: Ask the user a concise question with multiple choice options. Use when a decision or missing detail must be clarified before continuing.

### Skills (Specialized Knowledge)
- mcp__skills__skill-execute: Execute a skill within the main conversation. Invoke with skill id only (no arguments).

## Execution Patterns

### Single File Modification
1. Search for the file and relevant code using grep
2. Read file to verify exact boundaries
3. Modify using replace_edit
4. Run build to verify

### Multi-File Batch Update
1. Search and identify all files needing changes
2. Read all files in batch call
3. Prepare consistent changes
4. Execute modifications
5. Run build to verify all changes

### Complex Feature Implementation
1. Explore and understand current architecture
2. Create/modify utility functions first
3. Update dependent files in order
4. Add new features/components
5. Update integration points
6. Run tests and build
7. Verify all requirements met

### Refactoring Workflow
1. Find all usages of target code using grep search
2. Read all affected files
3. Prepare replacement pattern
4. Execute modifications
5. Verify no regressions
6. Run full test suite

## Error Handling

### When Edits Fail
1. Re-read file to check current state
2. Verify boundaries are complete
3. Check for intervening changes
4. Adjust search pattern
5. Retry with corrected information

### When Build Fails
1. Read error messages carefully
2. Fix errors in order of appearance
3. Verify syntax completeness
4. Re-run build until clean

### When Requirements Unclear
1. State what you understand
2. List assumptions you are making
3. Proceed with best interpretation
4. Document decisions for review

## Critical Reminders
- ALL context is in the prompt - read it completely before starting
- NEVER guess file paths - always search and verify
- ALWAYS verify code boundaries before editing
- USE batch read operations for multiple files
- RUN build after modifications to verify correctness
- FOCUS on correctness over speed
- MAINTAIN existing code style and patterns
- DOCUMENT significant decisions or assumptions"#;

const DEFAULT_GENERAL_AGENT_TOOLS_JSON: &str = r#"["*"]"#;

pub fn list_sub_agent_configs(database_path: &Path) -> Result<Vec<SubAgentConfigRecord>> {
    database::open_connection(database_path)
        .and_then(|connection| query_sub_agent_configs(&connection))
        .map_err(|error| database::database_error(database_path, "list sub-agent configs", error))
}

pub fn get_sub_agent_config(
    database_path: &Path,
    agent_id: &str,
) -> Result<Option<SubAgentConfigRecord>> {
    let normalized_agent_id = agent_id.trim();
    if normalized_agent_id.is_empty() {
        return Err(Error::from_reason("Sub-agent id is required"));
    }

    database::open_connection(database_path)
        .and_then(|connection| {
            let mut configs = query_sub_agent_configs(&connection)?;
            let found = configs
                .drain(..)
                .find(|config| config.agent_id == normalized_agent_id);
            Ok(found)
        })
        .map_err(|error| database::database_error(database_path, "get sub-agent config", error))
}

pub fn upsert_sub_agent_config(
    database_path: &Path,
    item: &SubAgentConfigInput,
) -> Result<()> {
    database::open_connection(database_path)
        .and_then(|connection| upsert_sub_agent_config_with_connection(&connection, item))
        .map_err(|error| database::database_error(database_path, "upsert sub-agent config", error))
}

pub fn delete_sub_agent_config(database_path: &Path, agent_id: &str) -> Result<()> {
    database::open_connection(database_path)
        .and_then(|connection| {
            connection.execute(
                "DELETE FROM sub_agent_configs WHERE agent_id = ?1 AND builtin = 0",
                [agent_id],
            )?;
            Ok(())
        })
        .map_err(|error| database::database_error(database_path, "delete sub-agent config", error))
}

pub fn seed_default_sub_agent_configs(database_path: &Path) -> Result<()> {
    database::open_connection(database_path)
        .and_then(|connection| {
            connection.execute(
                "INSERT OR IGNORE INTO sub_agent_configs (
                   id,
                   agent_id,
                   name,
                   description,
                   system_prompt,
                   tools_json,
                   config_profile,
                   builtin,
                   sort_order,
                   source,
                   created_at,
                   updated_at
                 ) VALUES (
                   ?1, 'agent_general', 'General Purpose Agent', ?2, ?3, ?4, '', 1, 0, 'builtin', datetime('now', 'localtime'), datetime('now', 'localtime')
                 )",
                params![
                    database::create_snowflake_id(),
                    "General-purpose multi-step task execution agent. Has complete tool access for code search, file modification, command execution, and various operations.",
                    DEFAULT_GENERAL_AGENT_SYSTEM_PROMPT,
                    DEFAULT_GENERAL_AGENT_TOOLS_JSON,
                ],
            )?;
            Ok(())
        })
        .map_err(|error| database::database_error(database_path, "seed default sub-agent configs", error))
}

fn query_sub_agent_configs(
    connection: &Connection,
) -> rusqlite::Result<Vec<SubAgentConfigRecord>> {
    let mut statement = connection.prepare(
        "SELECT id,
                agent_id,
                name,
                description,
                system_prompt,
                tools_json,
                config_profile,
                builtin,
                sort_order,
                source,
                updated_at
           FROM sub_agent_configs
          ORDER BY sort_order ASC, id ASC",
    )?;

    let rows = statement.query_map([], |row| {
        let builtin: i64 = row.get(7)?;
        Ok(SubAgentConfigRecord {
            id: row.get(0)?,
            agent_id: row.get(1)?,
            name: row.get(2)?,
            description: row.get(3)?,
            system_prompt: row.get(4)?,
            tools_json: row.get(5)?,
            config_profile: row.get(6)?,
            builtin: builtin != 0,
            sort_order: row.get(8)?,
            source: row.get(9)?,
            updated_at: row.get(10)?,
        })
    })?;

    rows.collect()
}

fn upsert_sub_agent_config_with_connection(
    connection: &Connection,
    item: &SubAgentConfigInput,
) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO sub_agent_configs (
           id,
           agent_id,
           name,
           description,
           system_prompt,
           tools_json,
           config_profile,
           builtin,
           sort_order,
           source,
           created_at,
           updated_at
         ) VALUES (
           ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, datetime('now', 'localtime'), datetime('now', 'localtime')
         )
         ON CONFLICT(agent_id) DO UPDATE SET
           name = excluded.name,
           description = excluded.description,
           system_prompt = excluded.system_prompt,
           tools_json = excluded.tools_json,
           config_profile = excluded.config_profile,
           builtin = excluded.builtin,
           sort_order = excluded.sort_order,
           source = excluded.source,
           updated_at = datetime('now', 'localtime')",
        params![
            database::create_snowflake_id(),
            item.agent_id,
            item.name,
            item.description,
            item.system_prompt,
            item.tools_json,
            item.config_profile,
            item.builtin as i32,
            item.sort_order,
            item.source,
        ],
    )?;

    Ok(())
}
