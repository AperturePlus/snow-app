use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use napi::bindgen_prelude::*;
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::super::database;

const DEFAULT_LANGUAGE_SETTING_NAME: &str = "Language";
const DEFAULT_LANGUAGE_SETTING_CODE: &str = "language";
const DEFAULT_LANGUAGE_SETTING_VALUE: &str = "en";

const DEFAULT_PROXY_BROWSER_SETTING_NAME: &str = "Proxy and browser settings";
const DEFAULT_PROXY_BROWSER_SETTING_CODE: &str = "proxy_browser_settings";
const DEFAULT_PROXY_BROWSER_SETTING_VALUE: &str = "{\"enabled\":false,\"port\":7890,\"browserPath\":\"\",\"browserDebugPort\":9222,\"searchEngine\":\"duckduckgo\"}";

const DEFAULT_TERMINAL_SETTING_NAME: &str = "Terminal settings";
const DEFAULT_TERMINAL_SETTING_CODE: &str = "terminal_settings";
const DEFAULT_TERMINAL_SETTING_VALUE: &str = "{\"shellPath\":\"\",\"fontFamily\":\"\",\"fontSize\":14,\"fontWeight\":\"normal\",\"lineHeight\":1.2,\"proxy\":\"\"}";

const DEFAULT_CODEBASE_SETTING_NAME: &str = "Codebase settings";
const DEFAULT_CODEBASE_SETTING_CODE: &str = "codebase_settings";
const DEFAULT_CODEBASE_SETTING_VALUE: &str = "{\"profileName\":\"default\",\"embeddingType\":\"jina\",\"embeddingModelName\":\"\",\"embeddingBaseUrl\":\"\",\"embeddingApiKey\":\"\",\"embeddingDimensions\":1536,\"batchMaxLines\":10,\"batchConcurrency\":3,\"chunkingMaxLinesPerChunk\":200,\"chunkingMinLinesPerChunk\":10,\"chunkingMinCharsPerChunk\":20,\"chunkingOverlapLines\":20,\"rerankingModelName\":\"\",\"rerankingBaseUrl\":\"\",\"rerankingApiKey\":\"\",\"rerankingContextLength\":4096,\"rerankingTopN\":5,\"configJson\":\"{}\",\"source\":\"manual\"}";

const DEFAULT_YOLO_MODE_SETTING_NAME: &str = "YOLO mode";
const DEFAULT_YOLO_MODE_SETTING_CODE: &str = "yolo_mode";
const DEFAULT_YOLO_MODE_SETTING_VALUE: &str = "false";

const DEFAULT_PLAN_MODE_SETTING_NAME: &str = "Plan mode";
const DEFAULT_PLAN_MODE_SETTING_CODE: &str = "plan_mode";
const DEFAULT_PLAN_MODE_SETTING_VALUE: &str = "false";

const DEFAULT_PRIVACY_SETTING_NAME: &str = "Privacy settings";
const DEFAULT_PRIVACY_SETTING_CODE: &str = "privacy_settings";
const DEFAULT_PRIVACY_SETTING_VALUE: &str = "{\"enabled\":false,\"mode\":\"local\",\"api\":{\"url\":\"\",\"apiKey\":\"\",\"model\":\"openai/privacy-filter\"},\"toolResults\":{\"tools\":[\"mcp__filesystem__read\",\"mcp__grep__search\",\"mcp__bash__terminal-execute\"]}}";

const PROJECT_MCP_SETTING_NAME: &str = "Project MCP scope";
const PROJECT_MCP_SETTING_CODE_PREFIX: &str = "project_mcp_scope_";
const PROJECT_SKILLS_SETTING_NAME: &str = "Project Skills scope";
const PROJECT_SKILLS_SETTING_CODE_PREFIX: &str = "project_skills_scope_";

const PROJECT_CODEBASE_SETTING_NAME: &str = "Project Codebase scope";
const PROJECT_CODEBASE_SETTING_CODE_PREFIX: &str = "project_codebase_scope_";

const PROJECT_TOOL_APPROVAL_SETTING_NAME: &str = "Project Tool approval scope";
const PROJECT_TOOL_APPROVAL_SETTING_CODE_PREFIX: &str = "project_tool_approval_scope_";

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct McpProjectScopeSettings {
    pub project_id: String,
    pub disabled_server_ids: BTreeSet<String>,
    pub disabled_tool_names: BTreeSet<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct SkillsProjectScopeSettings {
    pub project_id: String,
    pub skill_overrides: BTreeMap<String, bool>,
}

impl McpProjectScopeSettings {
    pub fn is_server_enabled(&self, server_id: &str) -> bool {
        !self.disabled_server_ids.contains(server_id)
    }

    pub fn is_tool_enabled(&self, tool_name: &str) -> bool {
        !self.disabled_tool_names.contains(tool_name)
    }

    fn set_server_enabled(&mut self, server_id: &str, enabled: bool) {
        update_disabled_set(&mut self.disabled_server_ids, server_id, enabled);
    }

    fn set_tool_enabled(&mut self, tool_name: &str, enabled: bool) {
        update_disabled_set(&mut self.disabled_tool_names, tool_name, enabled);
    }

    fn normalize(&mut self) {
        self.project_id = self.project_id.trim().to_string();
        self.disabled_server_ids = normalized_set(&self.disabled_server_ids);
        self.disabled_tool_names = normalized_set(&self.disabled_tool_names);
    }
}

impl SkillsProjectScopeSettings {
    pub fn effective_enabled(&self, skill_key: &str, default_enabled: bool) -> bool {
        self.skill_overrides
            .get(skill_key)
            .copied()
            .unwrap_or(default_enabled)
    }

    fn set_skill_enabled(&mut self, skill_key: &str, enabled: bool) {
        self.skill_overrides.insert(skill_key.to_string(), enabled);
    }

    fn normalize(&mut self) {
        self.project_id = self.project_id.trim().to_string();
        self.skill_overrides = self
            .skill_overrides
            .iter()
            .filter_map(|(skill_key, enabled)| {
                let normalized_skill_key = skill_key.trim();
                (!normalized_skill_key.is_empty())
                    .then(|| (normalized_skill_key.to_string(), *enabled))
            })
            .collect();
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct CodebaseProjectScopeSettings {
    pub project_id: String,
    pub enabled: Option<bool>,
    pub enable_agent_review: Option<bool>,
    pub enable_reranking: Option<bool>,
}

impl CodebaseProjectScopeSettings {
    fn set_enabled(&mut self, enabled: bool) {
        self.enabled = Some(enabled);
    }

    fn set_agent_review(&mut self, enabled: bool) {
        self.enable_agent_review = Some(enabled);
    }

    fn set_reranking(&mut self, enabled: bool) {
        self.enable_reranking = Some(enabled);
    }

    fn normalize(&mut self) {
        self.project_id = self.project_id.trim().to_string();
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ToolApprovalProjectScopeSettings {
    pub project_id: String,
    pub approved_tool_names: BTreeSet<String>,
}

impl ToolApprovalProjectScopeSettings {
    fn set_tool_approved(&mut self, tool_name: &str, approved: bool) {
        if approved {
            self.approved_tool_names.insert(tool_name.to_string());
        } else {
            self.approved_tool_names.remove(tool_name);
        }
    }

    fn normalize(&mut self) {
        self.project_id = self.project_id.trim().to_string();
        self.approved_tool_names = normalized_set(&self.approved_tool_names);
    }
}

pub fn seed_default_settings(database_path: &Path) -> Result<()> {
    Connection::open(database_path)
        .and_then(|connection| seed_default_settings_with_connection(&connection))
        .map_err(|error| database::database_error(database_path, "seed default settings", error))
}

pub fn get_system_setting_value(
    database_path: &Path,
    setting_code: &str,
) -> Result<Option<String>> {
    Connection::open(database_path)
        .and_then(|connection| {
            connection
                .query_row(
                    "SELECT setting_value FROM system_settings WHERE setting_code = ?1",
                    [setting_code],
                    |row| row.get(0),
                )
                .optional()
        })
        .map_err(|error| database::database_error(database_path, "read system setting", error))
}

pub fn set_system_setting(
    database_path: &Path,
    setting_name: &str,
    setting_code: &str,
    setting_value: &str,
) -> Result<()> {
    Connection::open(database_path)
        .and_then(|connection| {
            set_system_setting_with_connection(
                &connection,
                setting_name,
                setting_code,
                setting_value,
            )
        })
        .map_err(|error| database::database_error(database_path, "write system setting", error))
}

pub fn get_yolo_mode(database_path: &Path) -> Result<bool> {
    let Some(value) = get_system_setting_value(database_path, DEFAULT_YOLO_MODE_SETTING_CODE)? else {
        return Ok(false);
    };

    value.parse::<bool>().map_err(|error| {
        Error::new(
            Status::GenericFailure,
            format!("Failed to parse YOLO mode setting: {error}"),
        )
    })
}

pub fn set_yolo_mode(database_path: &Path, enabled: bool) -> Result<()> {
    set_system_setting(
        database_path,
        DEFAULT_YOLO_MODE_SETTING_NAME,
        DEFAULT_YOLO_MODE_SETTING_CODE,
        if enabled { "true" } else { "false" },
    )
}

pub fn get_plan_mode(database_path: &Path) -> Result<bool> {
    let Some(value) = get_system_setting_value(database_path, DEFAULT_PLAN_MODE_SETTING_CODE)? else {
        return Ok(false);
    };

    value.parse::<bool>().map_err(|error| {
        Error::new(
            Status::GenericFailure,
            format!("Failed to parse Plan mode setting: {error}"),
        )
    })
}

pub fn set_plan_mode(database_path: &Path, enabled: bool) -> Result<()> {
    set_system_setting(
        database_path,
        DEFAULT_PLAN_MODE_SETTING_NAME,
        DEFAULT_PLAN_MODE_SETTING_CODE,
        if enabled { "true" } else { "false" },
    )
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct PrivacyApiConfig {
    pub url: String,
    pub api_key: String,
    pub model: String,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct PrivacyToolResultsConfig {
    pub tools: Vec<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct PrivacySettings {
    pub enabled: bool,
    pub mode: String,
    pub api: PrivacyApiConfig,
    pub tool_results: PrivacyToolResultsConfig,
}

impl PrivacySettings {
    fn normalize(&mut self) {
        self.mode = self.mode.trim().to_string();
        if self.mode.is_empty() {
            self.mode = "local".to_string();
        }
        self.api.url = self.api.url.trim().to_string();
        self.api.api_key = self.api.api_key.trim().to_string();
        self.api.model = self.api.model.trim().to_string();
        if self.api.model.is_empty() {
            self.api.model = "openai/privacy-filter".to_string();
        }
        self.tool_results.tools = self
            .tool_results
            .tools
            .iter()
            .map(|tool| tool.trim().to_string())
            .filter(|tool| !tool.is_empty())
            .collect();
    }
}

pub fn get_privacy_settings(database_path: &Path) -> Result<PrivacySettings> {
    let Some(raw_value) = get_system_setting_value(database_path, DEFAULT_PRIVACY_SETTING_CODE)?
    else {
        return Ok(PrivacySettings::default());
    };

    let mut settings = serde_json::from_str::<PrivacySettings>(&raw_value).map_err(|error| {
        Error::new(
            Status::GenericFailure,
            format!("Failed to parse privacy settings: {error}"),
        )
    })?;
    settings.normalize();
    Ok(settings)
}

pub fn set_privacy_settings(database_path: &Path, settings: &PrivacySettings) -> Result<()> {
    let mut normalized = settings.clone();
    normalized.normalize();
    let setting_value = serde_json::to_string(&normalized).map_err(|error| {
        Error::new(
            Status::GenericFailure,
            format!("Failed to serialize privacy settings: {error}"),
        )
    })?;
    set_system_setting(
        database_path,
        DEFAULT_PRIVACY_SETTING_NAME,
        DEFAULT_PRIVACY_SETTING_CODE,
        &setting_value,
    )
}

pub fn get_mcp_project_scope_settings(
    database_path: &Path,
    project_id: &str,
) -> Result<McpProjectScopeSettings> {
    let normalized_project_id = normalize_required_value(project_id, "Project id")?;
    let setting_code = project_mcp_setting_code(&normalized_project_id);
    let Some(raw_value) = get_system_setting_value(database_path, &setting_code)? else {
        return Ok(McpProjectScopeSettings {
            project_id: normalized_project_id,
            ..McpProjectScopeSettings::default()
        });
    };

    let mut settings = serde_json::from_str::<McpProjectScopeSettings>(&raw_value).map_err(|error| {
        Error::new(
            Status::GenericFailure,
            format!("Failed to parse project MCP scope settings: {error}"),
        )
    })?;
    settings.normalize();
    if settings.project_id.is_empty() {
        settings.project_id = normalized_project_id.clone();
    }
    if settings.project_id != normalized_project_id {
        return Err(Error::new(
            Status::GenericFailure,
            "Project MCP scope setting identity does not match the requested project".to_string(),
        ));
    }

    Ok(settings)
}

pub fn set_mcp_project_server_enabled(
    database_path: &Path,
    project_id: &str,
    server_id: &str,
    enabled: bool,
) -> Result<()> {
    let normalized_server_id = normalize_required_value(server_id, "MCP server id")?;
    let mut settings = get_mcp_project_scope_settings(database_path, project_id)?;
    settings.set_server_enabled(&normalized_server_id, enabled);
    write_mcp_project_scope_settings(database_path, &settings)
}

pub fn set_mcp_project_tool_enabled(
    database_path: &Path,
    project_id: &str,
    tool_name: &str,
    enabled: bool,
) -> Result<()> {
    let normalized_tool_name = normalize_required_value(tool_name, "MCP tool name")?;
    let mut settings = get_mcp_project_scope_settings(database_path, project_id)?;
    settings.set_tool_enabled(&normalized_tool_name, enabled);
    write_mcp_project_scope_settings(database_path, &settings)
}

fn write_mcp_project_scope_settings(
    database_path: &Path,
    settings: &McpProjectScopeSettings,
) -> Result<()> {
    let setting_code = project_mcp_setting_code(&settings.project_id);
    let setting_value = serde_json::to_string(settings).map_err(|error| {
        Error::new(
            Status::GenericFailure,
            format!("Failed to serialize project MCP scope settings: {error}"),
        )
    })?;
    set_system_setting(
        database_path,
        PROJECT_MCP_SETTING_NAME,
        &setting_code,
        &setting_value,
    )
}

pub fn get_skills_project_scope_settings(
    database_path: &Path,
    project_id: &str,
) -> Result<SkillsProjectScopeSettings> {
    let normalized_project_id = normalize_required_value(project_id, "Project id")?;
    let setting_code = project_skills_setting_code(&normalized_project_id);
    let Some(raw_value) = get_system_setting_value(database_path, &setting_code)? else {
        return Ok(SkillsProjectScopeSettings {
            project_id: normalized_project_id,
            ..SkillsProjectScopeSettings::default()
        });
    };

    let mut settings = serde_json::from_str::<SkillsProjectScopeSettings>(&raw_value).map_err(|error| {
        Error::new(
            Status::GenericFailure,
            format!("Failed to parse project Skills scope settings: {error}"),
        )
    })?;
    settings.normalize();
    if settings.project_id.is_empty() {
        settings.project_id = normalized_project_id.clone();
    }
    if settings.project_id != normalized_project_id {
        return Err(Error::new(
            Status::GenericFailure,
            "Project Skills scope setting identity does not match the requested project".to_string(),
        ));
    }

    Ok(settings)
}

pub fn set_skills_project_skill_enabled(
    database_path: &Path,
    project_id: &str,
    skill_key: &str,
    enabled: bool,
) -> Result<()> {
    let normalized_skill_key = normalize_required_value(skill_key, "Skill key")?;
    let mut settings = get_skills_project_scope_settings(database_path, project_id)?;
    settings.set_skill_enabled(&normalized_skill_key, enabled);
    write_skills_project_scope_settings(database_path, &settings)
}

fn write_skills_project_scope_settings(
    database_path: &Path,
    settings: &SkillsProjectScopeSettings,
) -> Result<()> {
    let setting_code = project_skills_setting_code(&settings.project_id);
    let setting_value = serde_json::to_string(settings).map_err(|error| {
        Error::new(
            Status::GenericFailure,
            format!("Failed to serialize project Skills scope settings: {error}"),
        )
    })?;
    set_system_setting(
        database_path,
        PROJECT_SKILLS_SETTING_NAME,
        &setting_code,
        &setting_value,
    )
}

fn project_mcp_setting_code(project_id: &str) -> String {
    format!(
        "{PROJECT_MCP_SETTING_CODE_PREFIX}{}",
        blake3::hash(project_id.as_bytes()).to_hex()
    )
}

fn project_skills_setting_code(project_id: &str) -> String {
    format!(
        "{PROJECT_SKILLS_SETTING_CODE_PREFIX}{}",
        blake3::hash(project_id.as_bytes()).to_hex()
    )
}

pub fn get_codebase_project_scope_settings(
    database_path: &Path,
    project_id: &str,
) -> Result<CodebaseProjectScopeSettings> {
    let normalized_project_id = normalize_required_value(project_id, "Project id")?;
    let setting_code = project_codebase_setting_code(&normalized_project_id);
    let Some(raw_value) = get_system_setting_value(database_path, &setting_code)? else {
        return Ok(CodebaseProjectScopeSettings {
            project_id: normalized_project_id,
            ..CodebaseProjectScopeSettings::default()
        });
    };

    let mut settings =
        serde_json::from_str::<CodebaseProjectScopeSettings>(&raw_value).map_err(|error| {
            Error::new(
                Status::GenericFailure,
                format!("Failed to parse project Codebase scope settings: {error}"),
            )
        })?;
    settings.normalize();
    if settings.project_id.is_empty() {
        settings.project_id = normalized_project_id.clone();
    }
    if settings.project_id != normalized_project_id {
        return Err(Error::new(
            Status::GenericFailure,
            "Project Codebase scope setting identity does not match the requested project"
                .to_string(),
        ));
    }

    Ok(settings)
}

pub fn set_codebase_project_enabled(
    database_path: &Path,
    project_id: &str,
    enabled: bool,
) -> Result<()> {
    let mut settings = get_codebase_project_scope_settings(database_path, project_id)?;
    settings.set_enabled(enabled);
    write_codebase_project_scope_settings(database_path, &settings)
}

pub fn set_codebase_project_agent_review(
    database_path: &Path,
    project_id: &str,
    enabled: bool,
) -> Result<()> {
    let mut settings = get_codebase_project_scope_settings(database_path, project_id)?;
    settings.set_agent_review(enabled);
    write_codebase_project_scope_settings(database_path, &settings)
}

pub fn set_codebase_project_reranking(
    database_path: &Path,
    project_id: &str,
    enabled: bool,
) -> Result<()> {
    let mut settings = get_codebase_project_scope_settings(database_path, project_id)?;
    settings.set_reranking(enabled);
    write_codebase_project_scope_settings(database_path, &settings)
}

fn write_codebase_project_scope_settings(
    database_path: &Path,
    settings: &CodebaseProjectScopeSettings,
) -> Result<()> {
    let setting_code = project_codebase_setting_code(&settings.project_id);
    let setting_value = serde_json::to_string(settings).map_err(|error| {
        Error::new(
            Status::GenericFailure,
            format!("Failed to serialize project Codebase scope settings: {error}"),
        )
    })?;
    set_system_setting(
        database_path,
        PROJECT_CODEBASE_SETTING_NAME,
        &setting_code,
        &setting_value,
    )
}

fn project_codebase_setting_code(project_id: &str) -> String {
    format!(
        "{PROJECT_CODEBASE_SETTING_CODE_PREFIX}{}",
        blake3::hash(project_id.as_bytes()).to_hex()
    )
}

pub fn get_tool_approval_project_scope_settings(
    database_path: &Path,
    project_id: &str,
) -> Result<ToolApprovalProjectScopeSettings> {
    let normalized_project_id = normalize_required_value(project_id, "Project id")?;
    let setting_code = project_tool_approval_setting_code(&normalized_project_id);
    let Some(raw_value) = get_system_setting_value(database_path, &setting_code)? else {
        return Ok(ToolApprovalProjectScopeSettings {
            project_id: normalized_project_id,
            ..ToolApprovalProjectScopeSettings::default()
        });
    };

    let mut settings =
        serde_json::from_str::<ToolApprovalProjectScopeSettings>(&raw_value).map_err(|error| {
            Error::new(
                Status::GenericFailure,
                format!("Failed to parse project Tool approval scope settings: {error}"),
            )
        })?;
    settings.normalize();
    if settings.project_id.is_empty() {
        settings.project_id = normalized_project_id.clone();
    }
    if settings.project_id != normalized_project_id {
        return Err(Error::new(
            Status::GenericFailure,
            "Project Tool approval scope setting identity does not match the requested project"
                .to_string(),
        ));
    }

    Ok(settings)
}

pub fn list_tool_approval_project_approved_tools(
    database_path: &Path,
    project_id: &str,
) -> Result<Vec<String>> {
    let settings = get_tool_approval_project_scope_settings(database_path, project_id)?;
    Ok(settings.approved_tool_names.into_iter().collect())
}

pub fn set_tool_approval_project_tool_approved(
    database_path: &Path,
    project_id: &str,
    tool_name: &str,
    approved: bool,
) -> Result<()> {
    let normalized_tool_name = normalize_required_value(tool_name, "Tool name")?;
    let mut settings = get_tool_approval_project_scope_settings(database_path, project_id)?;
    settings.set_tool_approved(&normalized_tool_name, approved);
    write_tool_approval_project_scope_settings(database_path, &settings)
}

fn write_tool_approval_project_scope_settings(
    database_path: &Path,
    settings: &ToolApprovalProjectScopeSettings,
) -> Result<()> {
    let setting_code = project_tool_approval_setting_code(&settings.project_id);
    let setting_value = serde_json::to_string(settings).map_err(|error| {
        Error::new(
            Status::GenericFailure,
            format!("Failed to serialize project Tool approval scope settings: {error}"),
        )
    })?;
    set_system_setting(
        database_path,
        PROJECT_TOOL_APPROVAL_SETTING_NAME,
        &setting_code,
        &setting_value,
    )
}

fn project_tool_approval_setting_code(project_id: &str) -> String {
    format!(
        "{PROJECT_TOOL_APPROVAL_SETTING_CODE_PREFIX}{}",
        blake3::hash(project_id.as_bytes()).to_hex()
    )
}

fn normalize_required_value(value: &str, label: &str) -> Result<String> {
    let normalized = value.trim();
    if normalized.is_empty() {
        return Err(Error::new(
            Status::InvalidArg,
            format!("{label} is required"),
        ));
    }

    Ok(normalized.to_string())
}

fn normalized_set(values: &BTreeSet<String>) -> BTreeSet<String> {
    values
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .collect()
}

fn update_disabled_set(values: &mut BTreeSet<String>, value: &str, enabled: bool) {
    if enabled {
        values.remove(value);
    } else {
        values.insert(value.to_string());
    }
}

fn set_system_setting_with_connection(
    connection: &Connection,
    setting_name: &str,
    setting_code: &str,
    setting_value: &str,
) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO system_settings (id, setting_name, setting_code, setting_value, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, datetime('now'), datetime('now'))
         ON CONFLICT(setting_code) DO UPDATE SET
           setting_name = excluded.setting_name,
           setting_value = excluded.setting_value,
           updated_at = datetime('now')",
        (
            database::create_snowflake_id(),
            setting_name,
            setting_code,
            setting_value,
        ),
    )?;

    Ok(())
}

fn insert_default_setting(
    connection: &Connection,
    setting_name: &str,
    setting_code: &str,
    setting_value: &str,
) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT OR IGNORE INTO system_settings (id, setting_name, setting_code, setting_value, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, datetime('now'), datetime('now'))",
        (
            database::create_snowflake_id(),
            setting_name,
            setting_code,
            setting_value,
        ),
    )?;

    Ok(())
}

fn seed_default_settings_with_connection(connection: &Connection) -> rusqlite::Result<()> {
    insert_default_setting(
        connection,
        DEFAULT_LANGUAGE_SETTING_NAME,
        DEFAULT_LANGUAGE_SETTING_CODE,
        DEFAULT_LANGUAGE_SETTING_VALUE,
    )?;
    insert_default_setting(
        connection,
        DEFAULT_PROXY_BROWSER_SETTING_NAME,
        DEFAULT_PROXY_BROWSER_SETTING_CODE,
        DEFAULT_PROXY_BROWSER_SETTING_VALUE,
    )?;
    insert_default_setting(
        connection,
        DEFAULT_TERMINAL_SETTING_NAME,
        DEFAULT_TERMINAL_SETTING_CODE,
        DEFAULT_TERMINAL_SETTING_VALUE,
    )?;
    insert_default_setting(
        connection,
        DEFAULT_CODEBASE_SETTING_NAME,
        DEFAULT_CODEBASE_SETTING_CODE,
        DEFAULT_CODEBASE_SETTING_VALUE,
    )?;
    insert_default_setting(
        connection,
        DEFAULT_YOLO_MODE_SETTING_NAME,
        DEFAULT_YOLO_MODE_SETTING_CODE,
        DEFAULT_YOLO_MODE_SETTING_VALUE,
    )?;
    insert_default_setting(
        connection,
        DEFAULT_PLAN_MODE_SETTING_NAME,
        DEFAULT_PLAN_MODE_SETTING_CODE,
        DEFAULT_PLAN_MODE_SETTING_VALUE,
    )?;
    insert_default_setting(
        connection,
        DEFAULT_PRIVACY_SETTING_NAME,
        DEFAULT_PRIVACY_SETTING_CODE,
        DEFAULT_PRIVACY_SETTING_VALUE,
    )?;

    Ok(())
}

