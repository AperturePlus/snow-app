//! Built-in MCP service that lets the agent read and write Snow App global
//! configuration files (`~/.snow/*.json`) through a whitelist-driven
//! key-value API.
//!
//! Tools:
//! - `config-list`   — list manageable scopes and their keys
//! - `config-get`    — read a value (sensitive keys are masked)
//! - `config-set`    — write a value (whitelist + type check + backup + atomic write)
//! - `config-delete` — remove an optional key
//!
//! Safety model:
//! - Only whitelisted scopes/keys are reachable; arbitrary paths are rejected.
//! - Values are type-checked against each key's schema before writing.
//! - Sensitive keys (apiKey, visionApiKey) are masked on read; plaintext is
//!   never returned by this service.
//! - Every write is preceded by a timestamped backup under
//!   `~/.snow/.config-backups/` (latest 10 kept per file) and the target file
//!   is replaced atomically (tmp file + rename) so a crash cannot corrupt it.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use napi::bindgen_prelude::*;
use serde_json::{json, Map, Value};

use super::super::service::McpService;
use super::super::tools::McpTool;

pub const SERVER_ID: &str = "config";

const TOOL_LIST: &str = "list";
const TOOL_GET: &str = "get";
const TOOL_SET: &str = "set";
const TOOL_DELETE: &str = "delete";

/// DB-backed 配置域：子代理配置（写入应用 SQLite 数据库，与 UI 同源）。
/// key = agentId，value = { name, description, systemPrompt, toolsJson, configProfile }。
const SCOPE_SUB_AGENTS: &str = "subAgents";

/// DB-backed 配置域：生命周期 hook 配置。
/// key = hookType，value = { rules: [...] }；可选 projectId 表示项目级（缺省为全局）。
const SCOPE_HOOKS: &str = "hooks";

/// 技能管理配置域（委托 SkillsConfigService 实现，存储机制与 UI 一致）。
/// key = skillId；value 含 `enabled` 时切换开关，含 `url`+`location` 时从 GitHub 安装；
/// delete 卸载 GitHub 安装的技能；可选 projectId 表示项目级。
const SCOPE_SKILLS: &str = "skills";

/// 通过 config 工具写入的配置来源标记（与 mcpServers 同步的 source 约定一致）。
const SOURCE_SNOW_CLI: &str = "snow-cli";

/// 内置通用子代理 id，禁止通过 config 工具修改或删除。
const BUILTIN_GENERAL_AGENT_ID: &str = "agent_general";

/// 配置值类型。
#[derive(Clone, Copy)]
enum ValueType {
    String,
    Bool,
    Int,
    Object,
    Array,
}

/// 单个键的规格（白名单 + 类型 + 敏感标记）。
struct KeySpec {
    key: &'static str,
    value_type: ValueType,
    sensitive: bool,
}

/// 一个配置域（= 一个文件 + 若干白名单键）。
struct ScopeSpec {
    scope: &'static str,
    file_name: &'static str,
    /// 读写文件中的哪个对象根（如 `snowcfg`），None 表示文件顶层。
    root_key: Option<&'static str>,
    keys: &'static [KeySpec],
}

const SETTINGS_SCOPE_KEYS: &[KeySpec] = &[
    KeySpec { key: "mcpServers", value_type: ValueType::Object, sensitive: false },
    KeySpec { key: "codebase", value_type: ValueType::Object, sensitive: false },
    KeySpec { key: "sensitiveCommands", value_type: ValueType::Array, sensitive: false },
    KeySpec { key: "yoloMode", value_type: ValueType::Bool, sensitive: false },
    KeySpec { key: "planMode", value_type: ValueType::Bool, sensitive: false },
    KeySpec { key: "vulnerabilityHuntingMode", value_type: ValueType::Bool, sensitive: false },
    KeySpec { key: "toolSearchEnabled", value_type: ValueType::Bool, sensitive: false },
    KeySpec { key: "hybridCompressEnabled", value_type: ValueType::Bool, sensitive: false },
    KeySpec { key: "teamMode", value_type: ValueType::Bool, sensitive: false },
    KeySpec { key: "goal", value_type: ValueType::Object, sensitive: false },
    KeySpec { key: "ultraTodoEnabled", value_type: ValueType::Bool, sensitive: false },
];

const SNOWCFG_SCOPE_KEYS: &[KeySpec] = &[
    KeySpec { key: "baseUrl", value_type: ValueType::String, sensitive: false },
    KeySpec { key: "baseUrlMode", value_type: ValueType::String, sensitive: false },
    KeySpec { key: "apiKey", value_type: ValueType::String, sensitive: true },
    KeySpec { key: "requestMethod", value_type: ValueType::String, sensitive: false },
    KeySpec { key: "advancedModel", value_type: ValueType::String, sensitive: false },
    KeySpec { key: "basicModel", value_type: ValueType::String, sensitive: false },
    KeySpec { key: "supportsVision", value_type: ValueType::Bool, sensitive: false },
    KeySpec { key: "visionBaseUrl", value_type: ValueType::String, sensitive: false },
    KeySpec { key: "visionApiKey", value_type: ValueType::String, sensitive: true },
    KeySpec { key: "visionModel", value_type: ValueType::String, sensitive: false },
    KeySpec { key: "maxContextTokens", value_type: ValueType::Int, sensitive: false },
    KeySpec { key: "maxTokens", value_type: ValueType::Int, sensitive: false },
    KeySpec { key: "showThinking", value_type: ValueType::Bool, sensitive: false },
    KeySpec { key: "streamIdleTimeoutSec", value_type: ValueType::Int, sensitive: false },
    KeySpec { key: "maxRetries", value_type: ValueType::Int, sensitive: false },
    KeySpec { key: "retryDelayMs", value_type: ValueType::Int, sensitive: false },
    KeySpec { key: "enableAutoCompress", value_type: ValueType::Bool, sensitive: false },
    KeySpec { key: "autoCompressThreshold", value_type: ValueType::Int, sensitive: false },
    KeySpec { key: "toolResultTokenLimit", value_type: ValueType::Int, sensitive: false },
];

const PROXY_SCOPE_KEYS: &[KeySpec] = &[
    KeySpec { key: "enabled", value_type: ValueType::Bool, sensitive: false },
    KeySpec { key: "host", value_type: ValueType::String, sensitive: false },
    KeySpec { key: "port", value_type: ValueType::Int, sensitive: false },
    KeySpec { key: "searchEngine", value_type: ValueType::String, sensitive: false },
    KeySpec { key: "browserPath", value_type: ValueType::String, sensitive: false },
    KeySpec { key: "browserDebugPort", value_type: ValueType::Int, sensitive: false },
];

const APP_SCOPE_KEYS: &[KeySpec] = &[
    KeySpec { key: "activeProfile", value_type: ValueType::String, sensitive: false },
];

const SCOPES: &[ScopeSpec] = &[
    ScopeSpec { scope: "settings", file_name: "settings.json", root_key: None, keys: SETTINGS_SCOPE_KEYS },
    ScopeSpec { scope: "snowcfg", file_name: "config.json", root_key: Some("snowcfg"), keys: SNOWCFG_SCOPE_KEYS },
    ScopeSpec { scope: "proxy", file_name: "proxy-config.json", root_key: None, keys: PROXY_SCOPE_KEYS },
    ScopeSpec { scope: "app", file_name: "active-profile.json", root_key: None, keys: APP_SCOPE_KEYS },
];

/// 备份目录名（~/.snow/.config-backups）。
const BACKUP_DIR_NAME: &str = ".config-backups";
/// 每个文件保留的最大备份份数。
const MAX_BACKUPS_PER_FILE: usize = 10;

pub struct ConfigService {
    db_path: String,
}

impl ConfigService {
    pub fn new() -> Self {
        let storage_info = crate::storage::initialize_app_storage().map_err(|e| {
            Error::new(
                Status::GenericFailure,
                format!("Failed to initialize app storage: {e}"),
            )
        });
        let db_path = match storage_info {
            Ok(info) => info.database_path,
            Err(_) => String::new(),
        };
        ConfigService { db_path }
    }

    /// Async entry point used by `call_mcp_tool` in tools.rs.
    pub async fn execute_async(&self, tool_name: &str, args: &Value) -> napi::Result<Value> {
        let tool_name = tool_name.to_string();
        let args = args.clone();

        // skills scope（能力委托给 SkillsConfigService）：需要 async 能力
        // （GitHub 下载等），因此在 spawn_blocking 之外直接分发。
        if args.get("scope").and_then(Value::as_str) == Some(SCOPE_SKILLS) {
            return self.execute_skills_scope(&tool_name, &args).await;
        }

        let db_path = self.db_path.clone();

        tokio::task::spawn_blocking(move || {
            let service = ConfigService { db_path };
            service.execute(&tool_name, &args)
        })
        .await
        .map_err(|error| {
            Error::new(
                Status::GenericFailure,
                format!("Config service task failed: {error}"),
            )
        })?
    }

    /// `~/.snow` 目录路径（与 Snow CLI 共享）。
    fn snow_dir() -> PathBuf {
        dirs_next::home_dir()
            .map(|home| home.join(".snow"))
            .unwrap_or_else(|| PathBuf::from(".snow"))
    }

    /// 域对应的目标文件路径。
    fn scope_file_path(scope: &ScopeSpec) -> PathBuf {
        Self::snow_dir().join(scope.file_name)
    }

    fn find_scope(scope: &str) -> Option<&'static ScopeSpec> {
        SCOPES.iter().find(|spec| spec.scope == scope)
    }

    fn find_key<'a>(scope: &'a ScopeSpec, key: &str) -> Option<&'a KeySpec> {
        scope.keys.iter().find(|spec| spec.key == key)
    }

    /// 读取目标文件为 JSON 对象；文件不存在时返回域默认骨架。
    fn read_json(scope: &ScopeSpec) -> napi::Result<Map<String, Value>> {
        let file_path = Self::scope_file_path(scope);
        let content = match fs::read_to_string(&file_path) {
            Ok(content) => content,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Self::default_root(scope));
            }
            Err(error) => {
                return Err(Error::new(
                    Status::GenericFailure,
                    format!("Failed to read {}: {error}", file_path.display()),
                ));
            }
        };
        match serde_json::from_str::<Value>(&content) {
            Ok(Value::Object(map)) => Ok(map),
            Ok(_) => Err(Error::new(
                Status::GenericFailure,
                format!(
                    "Unexpected JSON root in {} (expected object)",
                    file_path.display()
                ),
            )),
            Err(error) => Err(Error::new(
                Status::GenericFailure,
                format!("Invalid JSON in {}: {error}", file_path.display()),
            )),
        }
    }

    /// 域默认骨架（root_key 存在时以空对象承载）。
    fn default_root(scope: &ScopeSpec) -> Map<String, Value> {
        match scope.root_key {
            Some(root_key) => {
                let mut root = Map::new();
                root.insert(root_key.to_string(), Value::Object(Map::new()));
                root
            }
            None => Map::new(),
        }
    }

    /// 获取实际存储配置的根对象（root_key 存在时取/建子对象）。
    fn config_root<'a>(
        scope: &ScopeSpec,
        root: &'a mut Map<String, Value>,
    ) -> napi::Result<&'a mut Map<String, Value>> {
        match scope.root_key {
            None => Ok(root),
            Some(root_key) => {
                if !root.contains_key(root_key) {
                    root.insert(root_key.to_string(), Value::Object(Map::new()));
                }
                match root.get_mut(root_key) {
                    Some(Value::Object(map)) => Ok(map),
                    _ => Err(Error::new(
                        Status::GenericFailure,
                        format!(
                            "Invalid JSON structure: `{root_key}` is not an object in {}",
                            scope.file_name
                        ),
                    )),
                }
            }
        }
    }

    /// 敏感值脱敏：字符串保留首尾各 4 字符，其余显示 `****`。
    fn mask_value(value: &Value) -> Value {
        match value {
            Value::String(text) => {
                let chars: Vec<char> = text.chars().collect();
                if chars.len() <= 8 {
                    json!("****")
                } else {
                    let head: String = chars[..4].iter().collect();
                    let tail: String = chars[chars.len() - 4..].iter().collect();
                    json!(format!("{head}****{tail}"))
                }
            }
            _ => json!("****"),
        }
    }

    /// 校验值的类型与结构（写前检查）。
    fn validate_value(key_spec: &KeySpec, value: &Value) -> napi::Result<()> {
        let type_ok = match key_spec.value_type {
            ValueType::String => value.is_string(),
            ValueType::Bool => value.is_boolean(),
            ValueType::Int => value.is_i64() || value.is_u64(),
            ValueType::Object => value.is_object(),
            ValueType::Array => value.is_array(),
        };
        if !type_ok {
            return Err(Error::new(
                Status::InvalidArg,
                format!(
                    "Invalid value type for key `{}` (expected {})",
                    key_spec.key,
                    type_name(key_spec.value_type)
                ),
            ));
        }
        // 结构性校验：mcpServers 的每个服务器条目必须是对象。
        if key_spec.key == "mcpServers" {
            if let Value::Object(servers) = value {
                for (name, entry) in servers {
                    if !entry.is_object() {
                        return Err(Error::new(
                            Status::InvalidArg,
                            format!("mcpServers.{name} must be an object"),
                        ));
                    }
                }
            }
        }
        Ok(())
    }

    /// 备份目标文件（保留 MAX_BACKUPS_PER_FILE 份，超出删除最旧）。
    fn backup_file(file_path: &Path) -> napi::Result<()> {
        if !file_path.exists() {
            return Ok(());
        }
        let backup_dir = Self::snow_dir().join(BACKUP_DIR_NAME);
        fs::create_dir_all(&backup_dir).map_err(|error| {
            Error::new(
                Status::GenericFailure,
                format!("Failed to create backup dir: {error}"),
            )
        })?;
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis())
            .unwrap_or(0);
        let file_name = file_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("config");
        let backup_path = backup_dir.join(format!("{file_name}.{timestamp}.bak"));
        fs::copy(file_path, &backup_path).map_err(|error| {
            Error::new(
                Status::GenericFailure,
                format!("Failed to backup {}: {error}", file_path.display()),
            )
        })?;

        // 清理超出上限的旧备份（按路径字典序即时间序）。
        let prefix = format!("{file_name}.");
        let mut backups: Vec<PathBuf> = fs::read_dir(&backup_dir)
            .map(|entries| {
                entries
                    .filter_map(|entry| entry.ok())
                    .map(|entry| entry.path())
                    .filter(|path| {
                        path.file_name()
                            .and_then(|name| name.to_str())
                            .is_some_and(|name| {
                                name.starts_with(&prefix) && name.ends_with(".bak")
                            })
                    })
                    .collect()
            })
            .unwrap_or_default();
        backups.sort();
        while backups.len() > MAX_BACKUPS_PER_FILE {
            if let Some(oldest) = backups.first() {
                let _ = fs::remove_file(oldest);
            }
            backups.remove(0);
        }
        Ok(())
    }

    /// 原子写入：先写 tmp 文件再 rename 覆盖目标。
    fn atomic_write(file_path: &Path, content: &str) -> napi::Result<()> {
        let tmp_path = file_path.with_extension("json.tmp");
        fs::write(&tmp_path, content).map_err(|error| {
            Error::new(
                Status::GenericFailure,
                format!("Failed to write {}: {error}", tmp_path.display()),
            )
        })?;
        fs::rename(&tmp_path, file_path).map_err(|error| {
            let _ = fs::remove_file(&tmp_path);
            Error::new(
                Status::GenericFailure,
                format!("Failed to replace {}: {error}", file_path.display()),
            )
        })
    }

    /// 把 settings.json 的 mcpServers 差集同步到应用 DB（生效作用域）。
    ///
    /// 语义与 UI "同步 Snow CLI MCP 设置" 完全一致：
    /// - upsert 文件中出现的每个服务器（serverId = `global:{name}`，
    ///   source = `snow-cli`）；
    /// - 删除 DB 中 source=snow-cli、serverId 以 `global:` 开头、但不在
    ///   新文件中的孤儿条目。
    ///
    /// 同步成功后配置立即生效（应用运行时直接读 DB），无需用户手动同步。
    fn sync_mcp_servers_to_db(&self, value: &Value) -> napi::Result<()> {
        use crate::storage::services::mcp_server_configs as mcp_store;

        let db_path = std::path::Path::new(&self.db_path);
        let servers = match value {
            Value::Object(servers) => servers,
            _ => return Ok(()),
        };

        let mut next_ids = std::collections::HashSet::new();
        for (index, (name, entry)) in servers.iter().enumerate() {
            let server = match entry {
                Value::Object(server) => server,
                _ => continue,
            };
            let server_id = format!("global:{name}");
            next_ids.insert(server_id.clone());

            let input = crate::storage::McpServerConfigInput {
                server_id,
                name: name.clone(),
                transport_type: server
                    .get("type")
                    .and_then(Value::as_str)
                    .unwrap_or("stdio")
                    .to_string(),
                url: server
                    .get("url")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                command: server
                    .get("command")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                args_json: serde_json::to_string(server.get("args").unwrap_or(&json!([])))
                    .unwrap_or_else(|_| "[]".to_string()),
                env_json: serde_json::to_string(server.get("env").unwrap_or(&json!({})))
                    .unwrap_or_else(|_| "{}".to_string()),
                headers_json: serde_json::to_string(server.get("headers").unwrap_or(&json!({})))
                    .unwrap_or_else(|_| "{}".to_string()),
                enabled: server.get("enabled").and_then(Value::as_bool).unwrap_or(true),
                timeout_ms: server
                    .get("timeoutMs")
                    .and_then(Value::as_i64)
                    .map(|value| value as i32),
                sort_order: index as i32,
                source: "snow-cli".to_string(),
            };
            mcp_store::upsert_mcp_server_config(db_path, &input).map_err(|error| {
                Error::new(
                    Status::GenericFailure,
                    format!("Failed to sync MCP server config to app database: {error}"),
                )
            })?;
        }

        // 差集删除：DB 中 source=snow-cli 的 global:* 孤儿条目。
        let existing = mcp_store::list_mcp_server_configs(db_path).map_err(|error| {
            Error::new(
                Status::GenericFailure,
                format!("Failed to list MCP server configs for sync: {error}"),
            )
        })?;
        for item in existing {
            if item.source == "snow-cli"
                && item.server_id.starts_with("global:")
                && !next_ids.contains(&item.server_id)
            {
                mcp_store::delete_mcp_server_config(db_path, &item.server_id).map_err(|error| {
                    Error::new(
                        Status::GenericFailure,
                        format!("Failed to delete stale MCP server config: {error}"),
                    )
                })?;
            }
        }
        Ok(())
    }

    /// 删除 settings.mcpServers 键时，同步清空 DB 中 source=snow-cli 的
    /// global:* 服务器（与 UI 同步的差集语义对称；UI 手动添加的 manual
    /// 条目不受影响）。
    fn clear_snow_cli_mcp_servers_from_db(&self) -> napi::Result<()> {
        use crate::storage::services::mcp_server_configs as mcp_store;

        let db_path = std::path::Path::new(&self.db_path);
        let existing = mcp_store::list_mcp_server_configs(db_path).map_err(|error| {
            Error::new(
                Status::GenericFailure,
                format!("Failed to list MCP server configs for cleanup: {error}"),
            )
        })?;
        for item in existing {
            if item.source == "snow-cli" && item.server_id.starts_with("global:") {
                mcp_store::delete_mcp_server_config(db_path, &item.server_id).map_err(|error| {
                    Error::new(
                        Status::GenericFailure,
                        format!("Failed to delete MCP server config: {error}"),
                    )
                })?;
            }
        }
        Ok(())
    }

    fn execute_list(&self, args: &Value) -> napi::Result<Value> {
        if let Some(scope_name) = args.get("scope").and_then(Value::as_str) {
            let project_id = optional_project_id(args);
            // DB-backed 配置域：直接查应用数据库（与 UI 同源）。
            if scope_name == SCOPE_SUB_AGENTS {
                return self.list_db_sub_agents(project_id);
            }
            if scope_name == SCOPE_HOOKS {
                return self.list_db_hooks(project_id);
            }

            let scope = Self::find_scope(scope_name).ok_or_else(|| invalid_scope_error(scope_name))?;
            let mut root = Self::read_json(scope)?;
            let config_root = Self::config_root(scope, &mut root)?;

            let mut keys = Vec::new();
            for key_spec in scope.keys {
                let configured = config_root.contains_key(key_spec.key);
                let display = match config_root.get(key_spec.key) {
                    Some(value) if key_spec.sensitive => Self::mask_value(value),
                    Some(value) => value.clone(),
                    None => Value::Null,
                };
                keys.push(json!({
                    "key": key_spec.key,
                    "type": type_name(key_spec.value_type),
                    "sensitive": key_spec.sensitive,
                    "configured": configured,
                    "value": display,
                }));
            }
            Ok(json!({
                "scope": scope.scope,
                "file": scope.file_name,
                "keys": keys,
            }))
        } else {
            let scopes: Vec<Value> = SCOPES
                .iter()
                .map(|scope| {
                    json!({
                        "scope": scope.scope,
                        "file": scope.file_name,
                        "keys": scope.keys.iter().map(|spec| spec.key).collect::<Vec<_>>(),
                    })
                })
                .collect();
            Ok(json!({ "scopes": scopes }))
        }
    }

    fn execute_get(&self, args: &Value) -> napi::Result<Value> {
        let scope_name = required_string(args, "scope")?;
        let key_name = required_string(args, "key")?;
        let project_id = optional_project_id(args);
        if scope_name == SCOPE_SUB_AGENTS {
            return self.get_db_sub_agent(key_name, project_id);
        }
        if scope_name == SCOPE_HOOKS {
            return self.get_db_hook(key_name, project_id);
        }

        let scope = Self::find_scope(scope_name).ok_or_else(|| invalid_scope_error(scope_name))?;
        let key_spec = Self::find_key(scope, key_name).ok_or_else(|| invalid_key_error(scope, key_name))?;

        let mut root = Self::read_json(scope)?;
        let config_root = Self::config_root(scope, &mut root)?;
        let display = match config_root.get(key_name) {
            Some(value) if key_spec.sensitive => Self::mask_value(value),
            Some(value) => value.clone(),
            None => Value::Null,
        };
        Ok(json!({
            "scope": scope.scope,
            "key": key_name,
            "value": display,
        }))
    }

    fn execute_set(&self, args: &Value) -> napi::Result<Value> {
        let scope_name = required_string(args, "scope")?;
        let key_name = required_string(args, "key")?;
        let value = args.get("value").cloned().ok_or_else(|| {
            Error::new(Status::InvalidArg, "value is required for config-set".to_string())
        })?;
        let project_id = optional_project_id(args);
        if scope_name == SCOPE_SUB_AGENTS {
            return self.set_db_sub_agent(key_name, &value, project_id);
        }
        if scope_name == SCOPE_HOOKS {
            return self.set_db_hook(key_name, &value, project_id);
        }

        let scope = Self::find_scope(scope_name).ok_or_else(|| invalid_scope_error(scope_name))?;
        let key_spec = Self::find_key(scope, key_name).ok_or_else(|| invalid_key_error(scope, key_name))?;
        Self::validate_value(key_spec, &value)?;

        // settings.mcpServers 特殊处理：同步到应用 DB（生效作用域），
        // 差集语义与 UI "同步 Snow CLI MCP 设置" 完全一致，立即生效。
        // DB 同步失败时中止（文件保持不变），保证文件与 DB 一致。
        if scope.scope == "settings" && key_name == "mcpServers" && !self.db_path.is_empty() {
            self.sync_mcp_servers_to_db(&value)?;
        }

        let file_path = Self::scope_file_path(scope);
        Self::backup_file(&file_path)?;

        let mut root = Self::read_json(scope)?;
        {
            let config_root = Self::config_root(scope, &mut root)?;
            config_root.insert(key_name.to_string(), value.clone());
        }
        let content = serde_json::to_string_pretty(&Value::Object(root)).map_err(|error| {
            Error::new(Status::GenericFailure, format!("Failed to serialize config: {error}"))
        })?;
        Self::atomic_write(&file_path, &content)?;

        let display = if key_spec.sensitive {
            Self::mask_value(&value)
        } else {
            value
        };
        Ok(json!({
            "scope": scope.scope,
            "key": key_name,
            "value": display,
        }))
    }

    fn execute_delete(&self, args: &Value) -> napi::Result<Value> {
        let scope_name = required_string(args, "scope")?;
        let key_name = required_string(args, "key")?;
        let project_id = optional_project_id(args);
        if scope_name == SCOPE_SUB_AGENTS {
            return self.delete_db_sub_agent(key_name, project_id);
        }
        if scope_name == SCOPE_HOOKS {
            return self.delete_db_hook(key_name, project_id);
        }

        let scope = Self::find_scope(scope_name).ok_or_else(|| invalid_scope_error(scope_name))?;
        // 仅校验键存在（白名单），无需保留绑定。
        Self::find_key(scope, key_name).ok_or_else(|| invalid_key_error(scope, key_name))?;

        let file_path = Self::scope_file_path(scope);
        let mut root = Self::read_json(scope)?;
        let removed = {
            let config_root = Self::config_root(scope, &mut root)?;
            config_root.remove(key_name).is_some()
        };
        if !removed {
            return Ok(json!({
                "scope": scope.scope,
                "key": key_name,
                "deleted": false,
            }));
        }

        // settings.mcpServers 删除时同步清空 DB 中 source=snow-cli 的
        // global:* 服务器（与 UI 同步的差集语义对称）。
        if scope.scope == "settings" && key_name == "mcpServers" && !self.db_path.is_empty() {
            self.clear_snow_cli_mcp_servers_from_db()?;
        }

        Self::backup_file(&file_path)?;
        let content = serde_json::to_string_pretty(&Value::Object(root)).map_err(|error| {
            Error::new(Status::GenericFailure, format!("Failed to serialize config: {error}"))
        })?;
        Self::atomic_write(&file_path, &content)?;
        Ok(json!({
            "scope": scope.scope,
            "key": key_name,
            "deleted": true,
        }))
    }

    // ---------------------------------------------------------------------
    // DB-backed scopes（subAgents / hooks）
    //
    // 直接读写应用 SQLite 数据库（与 UI 设置面板同源），写入立即生效。
    // 子代理写入统一标记 source=snow-cli、builtin=false；hooks 复用
    // hooks_configs 存储服务的完整校验（hookType、rules 结构、action 类型）。
    // ---------------------------------------------------------------------

    fn list_db_sub_agents(&self, project_id: Option<String>) -> napi::Result<Value> {
        let db_path = db_path_or_error(&self.db_path)?;
        let configs = crate::storage::services::sub_agent_configs::list_sub_agent_configs(
            db_path,
            project_id.as_deref(),
        )?;
        let items: Vec<Value> = configs
            .iter()
            .map(|config| {
                json!({
                    "agentId": config.agent_id,
                    "projectId": config.project_id,
                    "name": config.name,
                    "description": config.description,
                    "systemPrompt": config.system_prompt,
                    "toolsJson": config.tools_json,
                    "configProfile": config.config_profile,
                    "builtin": config.builtin,
                    "sortOrder": config.sort_order,
                    "source": config.source,
                    "updatedAt": config.updated_at,
                })
            })
            .collect();
        Ok(json!({
            "scope": SCOPE_SUB_AGENTS,
            "items": items,
            "count": items.len(),
        }))
    }

    fn get_db_sub_agent(
        &self,
        agent_id: &str,
        project_id: Option<String>,
    ) -> napi::Result<Value> {
        let db_path = db_path_or_error(&self.db_path)?;
        let config =
            crate::storage::services::sub_agent_configs::get_sub_agent_config(
                db_path,
                agent_id,
                project_id.as_deref(),
            )?;
        let value = match config {
            Some(config) => json!({
                "agentId": config.agent_id,
                "projectId": config.project_id,
                "name": config.name,
                "description": config.description,
                "systemPrompt": config.system_prompt,
                "toolsJson": config.tools_json,
                "configProfile": config.config_profile,
                "builtin": config.builtin,
                "sortOrder": config.sort_order,
                "source": config.source,
                "updatedAt": config.updated_at,
            }),
            None => Value::Null,
        };
        Ok(json!({
            "scope": SCOPE_SUB_AGENTS,
            "key": agent_id,
            "value": value,
        }))
    }

    fn set_db_sub_agent(
        &self,
        agent_id: &str,
        value: &Value,
        project_id: Option<String>,
    ) -> napi::Result<Value> {
        if agent_id == BUILTIN_GENERAL_AGENT_ID {
            return Err(Error::new(
                Status::InvalidArg,
                format!(
                    "{BUILTIN_GENERAL_AGENT_ID} is a built-in sub-agent and cannot be modified via config"
                ),
            ));
        }
        let db_path = db_path_or_error(&self.db_path)?;
        let config = value.as_object().ok_or_else(|| {
            Error::new(
                Status::InvalidArg,
                "value must be an object for the subAgents scope".to_string(),
            )
        })?;

        let name = config
            .get("name")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                Error::new(Status::InvalidArg, "value.name is required".to_string())
            })?;
        if name.chars().count() > 100 {
            return Err(Error::new(
                Status::InvalidArg,
                "value.name must be no longer than 100 characters".to_string(),
            ));
        }
        let description = config
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        if description.chars().count() > 500 {
            return Err(Error::new(
                Status::InvalidArg,
                "value.description must be no longer than 500 characters".to_string(),
            ));
        }
        let system_prompt = config
            .get("systemPrompt")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let config_profile = config
            .get("configProfile")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();

        // toolsJson 兼容两种形式：字符串数组或 JSON 字符串。
        let tools_json = match config.get("toolsJson") {
            Some(Value::Array(tools)) => serde_json::to_string(tools).map_err(|error| {
                Error::new(
                    Status::GenericFailure,
                    format!("Failed to serialize toolsJson: {error}"),
                )
            })?,
            Some(Value::String(tools)) => {
                serde_json::from_str::<Value>(tools).map_err(|error| {
                    Error::new(
                        Status::InvalidArg,
                        format!("value.toolsJson must be valid JSON: {error}"),
                    )
                })?;
                tools.clone()
            }
            None => "[]".to_string(),
            Some(_) => {
                return Err(Error::new(
                    Status::InvalidArg,
                    "value.toolsJson must be a string or an array of tool names".to_string(),
                ));
            }
        };

        let sort_order = config.get("sortOrder").and_then(Value::as_i64).unwrap_or(0) as i32;

        let item = crate::storage::SubAgentConfigInput {
            agent_id: agent_id.to_string(),
            name: name.to_string(),
            description,
            system_prompt,
            tools_json,
            config_profile,
            builtin: false,
            sort_order,
            source: SOURCE_SNOW_CLI.to_string(),
            project_id,
        };
        crate::storage::services::sub_agent_configs::upsert_sub_agent_config(
            db_path, &item,
        )?;
        Ok(json!({
            "scope": SCOPE_SUB_AGENTS,
            "key": agent_id,
            "saved": true,
        }))
    }

    fn delete_db_sub_agent(
        &self,
        agent_id: &str,
        project_id: Option<String>,
    ) -> napi::Result<Value> {
        if agent_id == BUILTIN_GENERAL_AGENT_ID {
            return Err(Error::new(
                Status::InvalidArg,
                format!("{BUILTIN_GENERAL_AGENT_ID} is a built-in sub-agent and cannot be deleted"),
            ));
        }
        let db_path = db_path_or_error(&self.db_path)?;
        let existing =
            crate::storage::services::sub_agent_configs::get_sub_agent_config(
                db_path,
                agent_id,
                project_id.as_deref(),
            )?;
        let deleted = existing.is_some();
        if let Some(config) = existing {
            if config.builtin {
                return Err(Error::new(
                    Status::InvalidArg,
                    "Built-in sub-agents cannot be deleted".to_string(),
                ));
            }
        }
        crate::storage::services::sub_agent_configs::delete_sub_agent_config(
            db_path,
            agent_id,
            project_id.as_deref(),
        )?;
        Ok(json!({
            "scope": SCOPE_SUB_AGENTS,
            "key": agent_id,
            "deleted": deleted,
        }))
    }

    fn list_db_hooks(&self, project_id: Option<String>) -> napi::Result<Value> {
        let db_path = db_path_or_error(&self.db_path)?;
        let scope = if project_id.is_some() { "project" } else { "global" };
        let records =
            crate::storage::services::hooks_configs::list_hook_configs(
                db_path,
                scope,
                project_id.as_deref(),
            )?;
        let items: Vec<Value> = records
            .iter()
            .map(|record| {
                json!({
                    "hookType": record.hook_type,
                    "scope": record.scope,
                    "projectId": record.project_id,
                    "rules": serde_json::from_str::<Value>(&record.rules_json)
                        .unwrap_or_else(|_| Value::Array(Vec::new())),
                    "rulesJson": record.rules_json,
                    "updatedAt": record.updated_at,
                })
            })
            .collect();
        Ok(json!({
            "scope": SCOPE_HOOKS,
            "projectId": project_id.unwrap_or_default(),
            "items": items,
            "count": items.len(),
        }))
    }

    fn get_db_hook(
        &self,
        hook_type: &str,
        project_id: Option<String>,
    ) -> napi::Result<Value> {
        let list = self.list_db_hooks(project_id)?;
        let items = list
            .get("items")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let found = items
            .iter()
            .find(|item| {
                item.get("hookType").and_then(Value::as_str) == Some(hook_type)
            })
            .cloned();
        Ok(json!({
            "scope": SCOPE_HOOKS,
            "key": hook_type,
            "value": found.unwrap_or(Value::Null),
        }))
    }

    fn set_db_hook(
        &self,
        hook_type: &str,
        value: &Value,
        project_id: Option<String>,
    ) -> napi::Result<Value> {
        let db_path = db_path_or_error(&self.db_path)?;
        let rules = value.get("rules").ok_or_else(|| {
            Error::new(
                Status::InvalidArg,
                "value.rules is required for the hooks scope".to_string(),
            )
        })?;
        if !rules.is_array() {
            return Err(Error::new(
                Status::InvalidArg,
                "value.rules must be an array of hook rules".to_string(),
            ));
        }
        let rules_json = serde_json::to_string(rules).map_err(|error| {
            Error::new(
                Status::GenericFailure,
                format!("Failed to serialize hook rules: {error}"),
            )
        })?;
        let scope = if project_id.is_some() { "project" } else { "global" };
        let item = crate::storage::HookConfigInput {
            hook_type: hook_type.to_string(),
            scope: scope.to_string(),
            project_id,
            rules_json,
        };
        // 复用 hooks_configs 的完整校验（hookType 白名单、rules 结构、action 类型）。
        crate::storage::services::hooks_configs::upsert_hook_config(db_path, &item)?;
        Ok(json!({
            "scope": SCOPE_HOOKS,
            "key": hook_type,
            "saved": true,
        }))
    }

    fn delete_db_hook(
        &self,
        hook_type: &str,
        project_id: Option<String>,
    ) -> napi::Result<Value> {
        let db_path = db_path_or_error(&self.db_path)?;
        let scope = if project_id.is_some() { "project" } else { "global" };
        // 先查存在性，与文件域 delete 的 deleted:false 语义对齐。
        let records =
            crate::storage::services::hooks_configs::list_hook_configs(
                db_path,
                scope,
                project_id.as_deref(),
            )?;
        let deleted = records
            .iter()
            .any(|record| record.hook_type == hook_type);
        crate::storage::services::hooks_configs::delete_hook_config(
            db_path,
            hook_type,
            scope,
            project_id.as_deref(),
        )?;
        Ok(json!({
            "scope": SCOPE_HOOKS,
            "key": hook_type,
            "deleted": deleted,
        }))
    }

    /// skills scope：把 config 工具的 list/get/set/delete 语义映射到
    /// SkillsConfigService 的内部工具，复用其全部校验与实现
    /// （list / setEnabled / installGithub / uninstall）。
    async fn execute_skills_scope(
        &self,
        tool_name: &str,
        args: &Value,
    ) -> napi::Result<Value> {
        let service = super::skills_config::SkillsConfigService::new();
        match tool_name {
            TOOL_LIST => service.execute_async("list", args).await,
            TOOL_GET => {
                let skill_id = required_string(args, "key")?;
                let list = service.execute_async("list", args).await?;
                let skills = list
                    .get("skills")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
                let found = skills
                    .iter()
                    .find(|skill| skill.get("id").and_then(Value::as_str) == Some(skill_id))
                    .cloned();
                Ok(json!({
                    "scope": SCOPE_SKILLS,
                    "key": skill_id,
                    "value": found.unwrap_or(Value::Null),
                }))
            }
            TOOL_SET => {
                let skill_id = required_string(args, "key")?;
                let value = args.get("value").cloned().ok_or_else(|| {
                    Error::new(
                        Status::InvalidArg,
                        "value is required for config-set".to_string(),
                    )
                })?;
                let project_id = optional_project_id(args);

                // 安装：value 含 url + location。
                if let Some(url) = value.get("url").and_then(Value::as_str) {
                    let location = value.get("location").and_then(Value::as_str).ok_or_else(|| {
                        Error::new(
                            Status::InvalidArg,
                            "value.location (\"global\" | \"project\") is required to install a skill"
                                .to_string(),
                        )
                    })?;
                    let mut install_args = json!({ "url": url, "location": location });
                    if let Some(project_id) = &project_id {
                        install_args["projectId"] = json!(project_id);
                    }
                    return service.execute_async("installGithub", &install_args).await;
                }

                // 开关：value 含 enabled。
                if let Some(enabled) = value.get("enabled").and_then(Value::as_bool) {
                    let mut set_args = json!({ "skillId": skill_id, "enabled": enabled });
                    if let Some(project_id) = &project_id {
                        set_args["projectId"] = json!(project_id);
                    }
                    return service.execute_async("setEnabled", &set_args).await;
                }

                Err(Error::new(
                    Status::InvalidArg,
                    "value must contain `enabled` (toggle) or `url` + `location` (install)".to_string(),
                ))
            }
            TOOL_DELETE => {
                let skill_id = required_string(args, "key")?;
                let mut delete_args = json!({ "skillId": skill_id });
                if let Some(project_id) = optional_project_id(args) {
                    delete_args["projectId"] = json!(project_id);
                }
                service.execute_async("uninstall", &delete_args).await
            }
            _ => Err(Error::new(
                Status::GenericFailure,
                format!(
                    "Unknown tool: \"{tool_name}\" for MCP server \"{SERVER_ID}\". Available tools: [config-list, config-get, config-set, config-delete]"
                ),
            )),
        }
    }
}

/// 校验并返回应用数据库路径；native 存储未初始化时给出明确错误。
fn db_path_or_error(db_path: &str) -> napi::Result<&Path> {
    if db_path.is_empty() {
        return Err(Error::new(
            Status::GenericFailure,
            "App database is not available (native storage failed to initialize)".to_string(),
        ));
    }
    Ok(Path::new(db_path))
}

/// 可选 projectId 参数：去空白，空串视为未提供（全局作用域）。
fn optional_project_id(args: &Value) -> Option<String> {
    args.get("projectId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

impl McpService for ConfigService {
    fn id(&self) -> &str {
        SERVER_ID
    }

    fn tools(&self) -> Vec<McpTool> {
        vec![
            McpTool {
                server_id: SERVER_ID.to_string(),
                name: TOOL_LIST.to_string(),
                description: "List manageable configuration scopes and their keys. Scopes: settings (~/.snow/settings.json: mcpServers, codebase, sensitiveCommands, yoloMode, planMode, ...), snowcfg (~/.snow/config.json snowcfg object: baseUrl, apiKey, advancedModel, ...), proxy (~/.snow/proxy-config.json: enabled, host, port, searchEngine, browserPath, browserDebugPort), app (~/.snow/active-profile.json: activeProfile). DB-backed scopes: subAgents (sub-agent configs in the app database, key=agentId), hooks (lifecycle hook configs in the app database, key=hookType). Pass `scope` to inspect a single scope with current values; sensitive values (apiKey, visionApiKey) are masked. Pass `projectId` to scope subAgents/hooks listings to a specific project (omitted = global).".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "scope": {
                            "type": "string",
                            "enum": ["settings", "snowcfg", "proxy", "app", "subAgents", "hooks", "skills"],
                            "description": "Optional config scope name; when omitted, lists all scopes."
                        },
                        "projectId": {
                            "type": "string",
                            "description": "Optional project id. For subAgents/hooks scopes: when provided, lists configs for that project; when omitted, lists global configs (subAgents without projectId returns ALL configs incl. project ones)."
                        }
                    },
                    "additionalProperties": false
                }),
            },
            McpTool {
                server_id: SERVER_ID.to_string(),
                name: TOOL_GET.to_string(),
                description: "Read the value of a configuration key. Sensitive keys (apiKey, visionApiKey) are always returned masked (e.g. sk-****abcd); this tool never exposes plaintext secrets. Returns null when the key is not configured. DB-backed scopes: subAgents (key=agentId) and hooks (key=hookType) read directly from the app database; pass optional `projectId` to read a project-scoped config (omitted = global).".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "scope": {
                            "type": "string",
                            "enum": ["settings", "snowcfg", "proxy", "app", "subAgents", "hooks", "skills"],
                            "description": "Config scope name."
                        },
                        "key": {
                            "type": "string",
                            "description": "Key name within the scope (see config-list)."
                        },
                        "projectId": {
                            "type": "string",
                            "description": "Optional project id for subAgents/hooks scopes; omitted = global config."
                        }
                    },
                    "required": ["scope", "key"],
                    "additionalProperties": false
                }),
            },
            McpTool {
                server_id: SERVER_ID.to_string(),
                name: TOOL_SET.to_string(),
                description: "Write a value for a configuration key. Only whitelisted scopes/keys are accepted; the value is type-checked, the target file is backed up to ~/.snow/.config-backups before the write, and the file is replaced atomically. Special case: writing `mcpServers` in the `settings` scope also syncs the servers into the app database (same diff semantics as the UI 'Sync Snow CLI MCP settings' action), so MCP changes take effect immediately without manual sync. Other settings (snowcfg/proxy/app) are file-based and may require an app restart or UI re-save. DB-backed scopes write directly to the app database and take effect immediately: subAgents (key=agentId, value={name, description, systemPrompt, toolsJson, configProfile}; toolsJson accepts a JSON string or an array of tool names; built-in agent_general cannot be modified) and hooks (key=hookType, value={rules:[{description, matcher?, hooks:[{type: command|prompt|context, command?, prompt?, content?, timeout?, enabled?}]}]}). Pass optional `projectId` to write a project-scoped config (omitted = global).".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "scope": {
                            "type": "string",
                            "enum": ["settings", "snowcfg", "proxy", "app", "subAgents", "hooks", "skills"],
                            "description": "Config scope name."
                        },
                        "key": {
                            "type": "string",
                            "description": "Key name within the scope (see config-list)."
                        },
                        "value": {
                            "description": "New value; type must match the key schema (see config-list)."
                        },
                        "projectId": {
                            "type": "string",
                            "description": "Optional project id for subAgents/hooks scopes; omitted = global config."
                        }
                    },
                    "required": ["scope", "key", "value"],
                    "additionalProperties": false
                }),
            },
            McpTool {
                server_id: SERVER_ID.to_string(),
                name: TOOL_DELETE.to_string(),
                description: "Delete a configuration key (e.g. clear an apiKey). The target file is backed up before the write and replaced atomically. Returns deleted=false when the key was not configured. DB-backed scopes delete from the app database: subAgents (key=agentId; built-in agent_general cannot be deleted) and hooks (key=hookType). Pass optional `projectId` to delete a project-scoped config (omitted = global).".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "scope": {
                            "type": "string",
                            "enum": ["settings", "snowcfg", "proxy", "app", "subAgents", "hooks", "skills"],
                            "description": "Config scope name."
                        },
                        "key": {
                            "type": "string",
                            "description": "Key name within the scope (see config-list)."
                        },
                        "projectId": {
                            "type": "string",
                            "description": "Optional project id for subAgents/hooks scopes; omitted = global config."
                        }
                    },
                    "required": ["scope", "key"],
                    "additionalProperties": false
                }),
            },
        ]
    }

    fn execute(&self, tool_name: &str, args: &Value) -> napi::Result<Value> {
        match tool_name {
            TOOL_LIST => self.execute_list(args),
            TOOL_GET => self.execute_get(args),
            TOOL_SET => self.execute_set(args),
            TOOL_DELETE => self.execute_delete(args),
            _ => Err(Error::new(
                Status::GenericFailure,
                format!(
                    "Unknown tool: \"{tool_name}\" for MCP server \"{SERVER_ID}\". Available tools: [config-list, config-get, config-set, config-delete]"
                ),
            )),
        }
    }
}

fn type_name(value_type: ValueType) -> &'static str {
    match value_type {
        ValueType::String => "string",
        ValueType::Bool => "boolean",
        ValueType::Int => "integer",
        ValueType::Object => "object",
        ValueType::Array => "array",
    }
}

fn available_scopes() -> String {
    let mut scopes: Vec<&str> = SCOPES
        .iter()
        .map(|spec| spec.scope)
        .collect();
    scopes.push(SCOPE_SUB_AGENTS);
    scopes.push(SCOPE_HOOKS);
    scopes.push(SCOPE_SKILLS);
    scopes.join(", ")
}

fn available_keys(scope: &ScopeSpec) -> String {
    scope
        .keys
        .iter()
        .map(|spec| spec.key)
        .collect::<Vec<_>>()
        .join(", ")
}

fn invalid_scope_error(scope: &str) -> Error {
    Error::new(
        Status::InvalidArg,
        format!(
            "Unknown config scope: \"{scope}\". Available scopes: [{}]",
            available_scopes()
        ),
    )
}

fn invalid_key_error(scope: &ScopeSpec, key: &str) -> Error {
    Error::new(
        Status::InvalidArg,
        format!(
            "Unknown config key: \"{key}\" in scope \"{}\". Available keys: [{}]",
            scope.scope,
            available_keys(scope)
        ),
    )
}

fn required_string<'a>(args: &'a Value, key: &str) -> napi::Result<&'a str> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| Error::new(Status::InvalidArg, format!("{key} is required")))
}
