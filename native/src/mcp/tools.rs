use std::path::PathBuf;

use napi::bindgen_prelude::*;
use napi_derive::napi;
use serde_json::{json, Value};

use crate::storage::services::system_settings::McpProjectScopeSettings;

use super::builtin::{
    execute_builtin_tool, get_builtin_servers_with_tools, get_builtin_tools,
};
use super::servers::bash::{BashService, BashStreamCallback};
use super::servers::browser::{BrowserCommandCallback, BrowserService};
use super::servers::grep::GrepService;
use super::servers::todo::TodoService;
use super::servers::user_interaction::{UserInteractionService, UserQuestionCallback};
use super::servers::websearch::WebSearchService;

// NOTE: list_mcp_tools 和 call_mcp_tool 的 #[napi] 导出在 exports/api.rs 中，
// 此处仅保留内部函数供 exports 层调用。

#[napi(object)]
pub struct McpToolDefinition {
    pub name: String,
    pub description: String,
    pub input_schema_json: String,
}

#[napi(object)]
pub struct McpProjectToolStatus {
    pub name: String,
    pub description: String,
    pub input_schema_json: String,
    pub enabled: bool,
}

#[napi(object)]
pub struct McpProjectServerStatus {
    pub id: String,
    pub name: String,
    pub source: String,
    pub global_enabled: bool,
    pub enabled: bool,
    pub tools: Vec<McpProjectToolStatus>,
    pub error: Option<String>,
}

#[derive(Clone)]
pub struct McpTool {
    pub server_id: String,
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

impl McpTool {
    pub fn full_name(&self) -> String {
        format!("mcp__{}__{}", self.server_id, self.name)
    }
}

pub async fn list_mcp_tools() -> napi::Result<Vec<McpToolDefinition>> {
    let tools = collect_all_mcp_tools(None).await?;
    Ok(to_tool_definitions(&tools))
}

pub async fn list_mcp_server_tools(
    config_server_id: String,
) -> napi::Result<Vec<McpToolDefinition>> {
    let tools = super::external::discover_server_tools(&config_server_id).await?;
    Ok(to_tool_definitions(&tools))
}

pub async fn list_mcp_project_servers(
    project_id: String,
) -> napi::Result<Vec<McpProjectServerStatus>> {
    let project_id = required_value(project_id, "Project id")?;
    let scope = load_project_scope(Some(&project_id)).await?.ok_or_else(|| {
        Error::new(
            Status::InvalidArg,
            "Project id is required to list project MCP servers".to_string(),
        )
    })?;
    let mut servers = get_builtin_servers_with_tools()
        .into_iter()
        .map(|(server_id, tools)| {
            let scope_server_id = builtin_scope_server_id(&server_id);
            let enabled = scope.is_server_enabled(&scope_server_id);
            McpProjectServerStatus {
                id: scope_server_id,
                name: builtin_server_name(&server_id).to_string(),
                source: "system".to_string(),
                global_enabled: true,
                enabled,
                tools: to_project_tool_statuses(&tools, &scope),
                error: None,
            }
        })
        .collect::<Vec<_>>();

    for external_server in super::external::discover_project_servers().await? {
        let scope_server_id =
            super::external::project_scope_server_id(&external_server.config_server_id);
        let enabled = external_server.global_enabled && scope.is_server_enabled(&scope_server_id);
        servers.push(McpProjectServerStatus {
            id: scope_server_id,
            name: external_server.name,
            source: "external".to_string(),
            global_enabled: external_server.global_enabled,
            enabled,
            tools: Vec::new(),
            error: None,
        });
    }

    Ok(servers)
}

pub async fn list_mcp_project_server_tools(
    project_id: String,
    server_id: String,
) -> napi::Result<Vec<McpProjectToolStatus>> {
    let project_id = required_value(project_id, "Project id")?;
    let server_id = required_value(server_id, "MCP server id")?;
    let scope = load_project_scope(Some(&project_id)).await?.ok_or_else(|| {
        Error::new(
            Status::InvalidArg,
            "Project id is required to list project MCP server tools".to_string(),
        )
    })?;

    if let Some(builtin_server_id) = server_id.strip_prefix("builtin:") {
        let tools = get_builtin_servers_with_tools()
            .into_iter()
            .find(|(known_server_id, _)| known_server_id == builtin_server_id)
            .map(|(_, tools)| tools)
            .ok_or_else(|| {
                Error::new(
                    Status::InvalidArg,
                    format!("Unknown MCP project server: {server_id}"),
                )
            })?;
        return Ok(to_project_tool_statuses(&tools, &scope));
    }

    let external_server_id = server_id.strip_prefix("external:").ok_or_else(|| {
        Error::new(
            Status::InvalidArg,
            format!("Unknown MCP project server: {server_id}"),
        )
    })?;
    let tools = super::external::discover_server_tools(external_server_id).await?;
    Ok(to_project_tool_statuses(&tools, &scope))
}

pub async fn set_mcp_project_server_enabled(
    project_id: String,
    server_id: String,
    enabled: bool,
) -> napi::Result<()> {
    let project_id = required_value(project_id, "Project id")?;
    let server_id = required_value(server_id, "MCP server id")?;
    let known_server = if let Some(builtin_server_id) = server_id.strip_prefix("builtin:") {
        get_builtin_servers_with_tools()
            .iter()
            .any(|(known_server_id, _)| known_server_id == builtin_server_id)
    } else if let Some(external_server_id) = server_id.strip_prefix("external:") {
        super::external::discover_project_servers()
            .await?
            .iter()
            .any(|server| server.config_server_id == external_server_id)
    } else {
        false
    };
    if !known_server {
        return Err(Error::new(
            Status::InvalidArg,
            format!("Unknown MCP project server: {server_id}"),
        ));
    }

    with_database_path(move |database_path| {
        crate::storage::services::system_settings::set_mcp_project_server_enabled(
            &database_path,
            &project_id,
            &server_id,
            enabled,
        )
    })
    .await
}

pub async fn set_mcp_project_tool_enabled(
    project_id: String,
    tool_name: String,
    enabled: bool,
) -> napi::Result<()> {
    let project_id = required_value(project_id, "Project id")?;
    let tool_name = required_value(tool_name, "MCP tool name")?;
    let tool_exists = if let Some(server_id) = server_id_from_tool_name(&tool_name) {
        if get_builtin_servers_with_tools()
            .iter()
            .any(|(builtin_server_id, _)| builtin_server_id == server_id)
        {
            get_builtin_tools()
                .iter()
                .any(|tool| tool.full_name() == tool_name)
        } else {
            super::external::resolve_project_scope_server_id(&tool_name)
                .await?
                .is_some()
        }
    } else {
        false
    };
    if !tool_exists {
        return Err(Error::new(
            Status::InvalidArg,
            format!("Unknown MCP project tool: {tool_name}"),
        ));
    }

    with_database_path(move |database_path| {
        crate::storage::services::system_settings::set_mcp_project_tool_enabled(
            &database_path,
            &project_id,
            &tool_name,
            enabled,
        )
    })
    .await
}

fn to_tool_definitions(tools: &[McpTool]) -> Vec<McpToolDefinition> {
    tools
        .iter()
        .map(|tool| McpToolDefinition {
            name: tool.full_name(),
            description: tool.description.clone(),
            input_schema_json: serialize_input_schema(tool),
        })
        .collect()
}

fn to_project_tool_statuses(
    tools: &[McpTool],
    scope: &McpProjectScopeSettings,
) -> Vec<McpProjectToolStatus> {
    tools
        .iter()
        .map(|tool| {
            let full_name = tool.full_name();
            McpProjectToolStatus {
                enabled: scope.is_tool_enabled(&full_name),
                name: full_name,
                description: tool.description.clone(),
                input_schema_json: serialize_input_schema(tool),
            }
        })
        .collect()
}

fn serialize_input_schema(tool: &McpTool) -> String {
    serde_json::to_string(&tool.input_schema).unwrap_or_else(|_| "{}".to_string())
}

fn required_value(value: String, label: &str) -> Result<String> {
    let normalized = value.trim();
    if normalized.is_empty() {
        return Err(Error::new(
            Status::InvalidArg,
            format!("{label} is required"),
        ));
    }

    Ok(normalized.to_string())
}

pub async fn collect_all_mcp_tools(project_id: Option<&str>) -> Result<Vec<McpTool>> {
    let scope = load_project_scope(project_id).await?;
    let mut tools = get_builtin_tools()
        .into_iter()
        .filter(|tool| tool_is_enabled(tool, scope.as_ref()))
        .collect::<Vec<_>>();
    match super::external::discover_tools(scope.as_ref()).await {
        Ok(external_tools) => tools.extend(external_tools),
        Err(error) => eprintln!("Failed to discover external MCP tools: {error}"),
    }
    Ok(tools)
}

fn tool_is_enabled(tool: &McpTool, scope: Option<&McpProjectScopeSettings>) -> bool {
    let Some(scope) = scope else {
        return true;
    };

    scope.is_server_enabled(&builtin_scope_server_id(&tool.server_id))
        && scope.is_tool_enabled(&tool.full_name())
}

fn builtin_scope_server_id(server_id: &str) -> String {
    format!("builtin:{server_id}")
}

fn server_id_from_tool_name(tool_name: &str) -> Option<&str> {
    let mut parts = tool_name.splitn(3, "__");
    if parts.next()? != "mcp" {
        return None;
    }
    let server_id = parts.next()?;
    let tool_id = parts.next()?;
    if server_id.is_empty() || tool_id.is_empty() {
        return None;
    }

    Some(server_id)
}

fn builtin_server_name(server_id: &str) -> &str {
    match server_id {
        "filesystem" => "Filesystem",
        "bash" => "Terminal",
        "todo" => "TODO",
        "grep" => "Search",
        "websearch" => "Web search",
        "browser" => "Browser",
        "user-interaction" => "User interaction",
        _ => server_id,
    }
}

async fn ensure_project_tool_enabled(
    project_id: Option<&str>,
    tool_name: &str,
) -> Result<()> {
    let Some(scope) = load_project_scope(project_id).await? else {
        return Ok(());
    };
    let Some(server_id) = server_id_from_tool_name(tool_name) else {
        return Err(Error::new(
            Status::InvalidArg,
            format!("Invalid MCP tool name: {tool_name}"),
        ));
    };
    let server_scope_id = if get_builtin_servers_with_tools()
        .iter()
        .any(|(builtin_server_id, _)| builtin_server_id == server_id)
    {
        builtin_scope_server_id(server_id)
    } else {
        super::external::resolve_project_scope_server_id(tool_name)
            .await?
            .ok_or_else(|| {
                Error::new(
                    Status::GenericFailure,
                    format!("MCP tool is no longer available: {tool_name}"),
                )
            })?
    };

    if !scope.is_server_enabled(&server_scope_id) {
        return Err(Error::new(
            Status::GenericFailure,
            format!("MCP server is disabled for the current project: {server_scope_id}"),
        ));
    }
    if !scope.is_tool_enabled(tool_name) {
        return Err(Error::new(
            Status::GenericFailure,
            format!("MCP tool is disabled for the current project: {tool_name}"),
        ));
    }

    Ok(())
}

async fn load_project_scope(
    project_id: Option<&str>,
) -> Result<Option<McpProjectScopeSettings>> {
    let Some(project_id) = project_id.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let project_id = project_id.to_string();
    with_database_path(move |database_path| {
        crate::storage::services::system_settings::get_mcp_project_scope_settings(
            &database_path,
            &project_id,
        )
        .map(Some)
    })
    .await
}

async fn with_database_path<T, F>(operation: F) -> Result<T>
where
    T: Send + 'static,
    F: FnOnce(PathBuf) -> Result<T> + Send + 'static,
{
    tokio::task::spawn_blocking(move || {
        let storage_info = crate::storage::initialize_app_storage()?;
        operation(PathBuf::from(storage_info.database_path))
    })
    .await
    .map_err(|error| {
        Error::new(
            Status::GenericFailure,
            format!("Failed to access project MCP scope storage: {error}"),
        )
    })?
}

pub fn tools_as_openai_chat_json(tools: &[McpTool]) -> Value {
    let functions: Vec<Value> = tools
        .iter()
        .map(|tool| {
            let sanitized_schema = sanitize_tool_input_schema(&tool.input_schema);
            json!({
                "type": "function",
                "function": {
                    "name": tool.full_name(),
                    "description": tool.description,
                    "parameters": sanitized_schema,
                }
            })
        })
        .collect();

    Value::Array(functions)
}

/// Tool APIs require the root input schema to describe an object. Some
/// compatible gateways reject root `oneOf`/`anyOf`/`allOf` combinators when a
/// branch does not explicitly declare an object, even if the root has
/// `type: "object"`. Keep nested constraints intact, but remove root
/// combinators and always emit an object schema. Runtime tool validation still
/// enforces cross-field requirements that cannot be represented at the root.
fn sanitize_tool_input_schema(schema: &Value) -> Value {
    let mut result = schema.as_object().cloned().unwrap_or_default();

    result.remove("oneOf");
    result.remove("anyOf");
    result.remove("allOf");
    result.insert("type".to_string(), Value::String("object".to_string()));

    Value::Object(result)
}

pub fn tools_as_anthropic_json(tools: &[McpTool]) -> Value {
    let tools_json: Vec<Value> = tools
        .iter()
        .map(|tool| {
            let sanitized_schema = sanitize_tool_input_schema(&tool.input_schema);
            json!({
                "name": tool.full_name(),
                "description": tool.description,
                "input_schema": sanitized_schema,
            })
        })
        .collect();

    Value::Array(tools_json)
}

pub fn tools_as_openai_responses_json(tools: &[McpTool]) -> Value {
    let tools_json: Vec<Value> = tools
        .iter()
        .map(|tool| {
            let sanitized_schema = sanitize_tool_input_schema(&tool.input_schema);
            json!({
                "type": "function",
                "name": tool.full_name(),
                "description": tool.description,
                "parameters": sanitized_schema,
            })
        })
        .collect();

    Value::Array(tools_json)
}

pub fn tools_as_gemini_json(tools: &[McpTool]) -> Value {
    let function_declarations: Vec<Value> = tools
        .iter()
        .map(|tool| {
            let sanitized_schema = sanitize_tool_input_schema(&tool.input_schema);
            json!({
                "name": tool.full_name(),
                "description": tool.description,
                "parameters": sanitized_schema,
            })
        })
        .collect();

    json!({
        "functionDeclarations": function_declarations
    })
}

/// Execute an MCP tool and capture incremental checkpoint state immediately
pub async fn call_mcp_tool(
    tool_full_name: String,
    args_json: String,
    project_id: Option<String>,
    checkpoint_ids: Vec<String>,
    checkpoint_work_dir: Option<String>,
    sensitive_authorization_token: Option<String>,
    on_chunk: BashStreamCallback,
    on_browser_command: BrowserCommandCallback,
    on_user_question: UserQuestionCallback,
) -> napi::Result<String> {
    ensure_project_tool_enabled(project_id.as_deref(), &tool_full_name).await?;
    let args = parse_tool_args(&tool_full_name, &args_json)?;

    let checkpoint_ids_after = checkpoint_ids.clone();
    let checkpoint_work_dir_after = checkpoint_work_dir.clone();
    let checkpoint_tool_name = tool_full_name.clone();
    let checkpoint_args = args.clone();
    tokio::task::spawn_blocking(move || {
        capture_checkpoint_before_tool(
            &checkpoint_tool_name,
            &checkpoint_args,
            checkpoint_ids,
            checkpoint_work_dir,
        )
    })
    .await
    .map_err(|error| {
        Error::new(
            Status::GenericFailure,
            format!("Failed to capture checkpoint before tool execution: {error}"),
        )
    })??;

    let result = if tool_full_name == "mcp__bash__terminal-execute" {
        let terminal_result = BashService::new()
            .execute_terminal_stream(
                &args,
                sensitive_authorization_token.as_deref(),
                on_chunk,
            )
            .await;
        tokio::task::spawn_blocking(move || {
            capture_checkpoint_after_tool(checkpoint_ids_after, checkpoint_work_dir_after)
        })
        .await
        .map_err(|error| {
            Error::new(
                Status::GenericFailure,
                format!("Failed to capture checkpoint after tool execution: {error}"),
            )
        })??;
        terminal_result?
    } else if tool_full_name == "mcp__grep__search" {
        GrepService::new().execute_search(&args).await?
    } else if tool_full_name == "mcp__todo__todo-manage" {
        TodoService::new().execute_async(&args).await?
    } else if tool_full_name == "mcp__websearch__websearch-search" {
        WebSearchService::new().execute_search(&args).await?
    } else if tool_full_name == "mcp__websearch__websearch-fetch" {
        WebSearchService::new().execute_fetch(&args).await?
    } else if let Some(tool_name) = tool_full_name.strip_prefix("mcp__browser__") {
        BrowserService::new()
            .execute_async(tool_name, &args, &on_browser_command)
            .await?
    } else if tool_full_name == "mcp__user-interaction__askUserQuestion" {
        UserInteractionService::new()
            .execute_async(&args, &on_user_question)
            .await?
    } else if let Some(result) = super::external::call_tool(&tool_full_name, &args).await? {
        result
    } else {
        tokio::task::spawn_blocking(move || execute_builtin_tool(&tool_full_name, &args))
            .await
            .map_err(|error| {
                Error::new(
                    Status::GenericFailure,
                    format!("Failed to execute MCP tool: {error}"),
                )
            })??
    };

    serde_json::to_string(&result).map_err(|error| {
        Error::new(
            Status::GenericFailure,
            format!("Failed to serialize result: {error}"),
        )
    })
}

fn parse_tool_args(tool_full_name: &str, args_json: &str) -> napi::Result<Value> {
    serde_json::from_str(args_json).map_err(|error| {
        let received = args_json.chars().take(200).collect::<String>();
        let suffix = if args_json.chars().count() > 200 {
            "..."
        } else {
            ""
        };

        Error::new(
            Status::InvalidArg,
            format!(
                "Failed to parse arguments JSON for tool \"{tool_full_name}\": {error}. Received: {received}{suffix}"
            ),
        )
    })
}

fn capture_checkpoint_before_tool(
    tool_full_name: &str,
    args: &Value,
    checkpoint_ids: Vec<String>,
    checkpoint_work_dir: Option<String>,
) -> napi::Result<()> {
    if checkpoint_ids.is_empty() {
        return Ok(());
    }
    let work_dir = checkpoint_work_dir.ok_or_else(|| {
        Error::new(
            Status::InvalidArg,
            "Checkpoint working directory is required".to_string(),
        )
    })?;

    match tool_full_name {
        "mcp__filesystem__replace_edit" | "mcp__filesystem__create" => {
            let file_path = args
                .get("filePath")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    Error::new(
                        Status::InvalidArg,
                        "filePath is required for checkpoint capture".to_string(),
                    )
                })?;
            crate::storage::services::checkpoint::record_checkpoint_file(
                checkpoint_ids,
                work_dir,
                file_path.to_string(),
            )
        }
        "mcp__bash__terminal-execute" => {
            crate::storage::services::checkpoint::record_checkpoint_worktree(
                checkpoint_ids,
                work_dir,
            )
        }
        _ => Ok(()),
    }
}

fn capture_checkpoint_after_tool(
    checkpoint_ids: Vec<String>,
    checkpoint_work_dir: Option<String>,
) -> napi::Result<()> {
    if checkpoint_ids.is_empty() {
        return Ok(());
    }
    let work_dir = checkpoint_work_dir.ok_or_else(|| {
        Error::new(
            Status::InvalidArg,
            "Checkpoint working directory is required".to_string(),
        )
    })?;
    crate::storage::services::checkpoint::record_checkpoint_worktree_after(
        checkpoint_ids,
        work_dir,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_tool_input_schema_removes_only_root_combinators() {
        let schema = json!({
            "type": "object",
            "properties": {
                "target": {
                    "oneOf": [
                        { "type": "string" },
                        { "type": "number" }
                    ]
                }
            },
            "anyOf": [
                { "required": ["selector"] },
                { "type": "string" }
            ],
            "oneOf": [
                { "type": "object" },
                { "type": "string" }
            ],
            "allOf": [
                { "type": "object" }
            ]
        });

        let sanitized = sanitize_tool_input_schema(&schema);

        assert_eq!(sanitized.get("type").and_then(Value::as_str), Some("object"));
        assert!(sanitized.get("anyOf").is_none());
        assert!(sanitized.get("oneOf").is_none());
        assert!(sanitized.get("allOf").is_none());
        assert!(sanitized.pointer("/properties/target/oneOf").is_some());
    }

    #[test]
    fn sanitize_tool_input_schema_converts_non_object_root() {
        let sanitized = sanitize_tool_input_schema(&json!([
            { "type": "object" },
            { "type": "string" }
        ]));

        assert_eq!(sanitized, json!({ "type": "object" }));
    }
}
