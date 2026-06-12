import {
  useCallback,
  useEffect,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import {
  Database,
  Download,
  Eye,
  EyeOff,
  Loader2,
  Pencil,
  Plus,
  Save,
  Server,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { AutoDismissNotice } from "../AutoDismissNotice";
import { useI18n } from "../../i18n";
import type { ApiConfigInput, ApiConfigRecord } from "../../../preload";

type ApiSettingsPanelProps = {
  onClose?: () => void;
};

type ApiConfigFormData = {
  profileName: string;
  displayName: string;
  baseUrl: string;
  baseUrlMode: string;
  apiKey: string;
  requestMethod: string;
  advancedModel: string;
  basicModel: string;
  isActive: boolean;
  supportsVision: boolean;
  visionBaseUrl: string;
  visionApiKey: string;
  visionRequestMethod: string;
  visionModel: string;
  maxContextTokens: string;
  maxTokens: string;
  streamIdleTimeoutSec: string;
};
const DEFAULT_API_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_REQUEST_METHOD = "chat";
const REQUEST_METHODS = ["chat", "responses", "anthropic", "gemini"];
const ENABLED_STATUS_LABEL = "Enabled";
const DISABLED_STATUS_LABEL = "Not enabled";

const emptyForm = (index: number, active: boolean): ApiConfigFormData => ({
  profileName: `manual-${index}`,
  displayName: "",
  baseUrl: DEFAULT_API_BASE_URL,
  baseUrlMode: "auto",
  apiKey: "",
  requestMethod: DEFAULT_REQUEST_METHOD,
  advancedModel: "",
  basicModel: "",
  isActive: active,
  supportsVision: true,
  visionBaseUrl: "",
  visionApiKey: "",
  visionRequestMethod: DEFAULT_REQUEST_METHOD,
  visionModel: "",
  maxContextTokens: "",
  maxTokens: "",
  streamIdleTimeoutSec: "",
});

const parseNum = (v: string): number | null => {
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
};

function FormFields({
  data,
  onChange,
  disabled,
  isNew,
}: {
  data: ApiConfigFormData;
  onChange: (field: keyof ApiConfigFormData, value: string | boolean) => void;
  disabled: boolean;
  isNew: boolean;
}) {
  const { t } = useI18n();
  const [showApiKey, setShowApiKey] = useState(false);
  const [showVisionKey, setShowVisionKey] = useState(false);

  const ch =
    (field: keyof ApiConfigFormData) =>
    (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const v =
        e.target instanceof HTMLInputElement && e.target.type === "checkbox"
          ? e.target.checked
          : e.target.value;
      onChange(field, v);
    };

  return (
    <div className="api-settings-form-body">
      {/* ── Basic ── */}
      <div className="api-settings-form-section">
        <strong className="api-settings-form-section-title">
          {t("settings.formBasic", { defaultValue: "Basic" })}
        </strong>
        <div className="api-settings-form-grid">
          {isNew && (
            <label className="api-settings-field">
              <span>
                {t("settings.apiProfileName", { defaultValue: "Profile name" })}
              </span>
              <input
                value={data.profileName}
                onChange={ch("profileName")}
                placeholder="openai"
                required
                disabled={disabled}
              />
            </label>
          )}
          <label className="api-settings-field">
            <span>
              {t("settings.apiDisplayName", { defaultValue: "Display name" })}
            </span>
            <input
              value={data.displayName}
              onChange={ch("displayName")}
              placeholder={data.profileName}
              disabled={disabled}
            />
          </label>
          <label className="api-settings-field wide">
            <span>
              {t("settings.apiBaseUrl", { defaultValue: "Base URL" })}
            </span>
            <input
              value={data.baseUrl}
              onChange={ch("baseUrl")}
              placeholder={DEFAULT_API_BASE_URL}
              disabled={disabled}
            />
          </label>
          <label className="api-settings-field">
            <span>
              {t("settings.apiBaseUrlMode", { defaultValue: "Base URL mode" })}
            </span>
            <select
              value={data.baseUrlMode}
              onChange={ch("baseUrlMode")}
              disabled={disabled}
            >
              <option value="auto">auto</option>
              <option value="custom">custom</option>
            </select>
          </label>
          <label className="api-settings-field">
            <span>{t("settings.apiKey", { defaultValue: "API key" })}</span>
            <div className="api-settings-password-wrap">
              <input
                value={data.apiKey}
                onChange={ch("apiKey")}
                placeholder="sk-..."
                type={showApiKey ? "text" : "password"}
                disabled={disabled}
              />
              <button
                type="button"
                className="api-settings-password-toggle"
                onClick={() => setShowApiKey((v) => !v)}
                tabIndex={-1}
              >
                {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </label>
          <label className="api-settings-field">
            <span>
              {t("settings.apiRequestMethod", {
                defaultValue: "Request method",
              })}
            </span>
            <select
              value={data.requestMethod}
              onChange={ch("requestMethod")}
              disabled={disabled}
            >
              {REQUEST_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {/* ── Models ── */}
      <div className="api-settings-form-section">
        <strong className="api-settings-form-section-title">
          {t("settings.formModels", { defaultValue: "Models" })}
        </strong>
        <div className="api-settings-form-grid">
          <label className="api-settings-field">
            <span>
              {t("settings.apiAdvancedModel", {
                defaultValue: "Advanced model",
              })}
            </span>
            <input
              value={data.advancedModel}
              onChange={ch("advancedModel")}
              placeholder="gpt-4.1"
              disabled={disabled}
            />
          </label>
          <label className="api-settings-field">
            <span>
              {t("settings.apiBasicModel", { defaultValue: "Basic model" })}
            </span>
            <input
              value={data.basicModel}
              onChange={ch("basicModel")}
              placeholder="gpt-4.1-mini"
              disabled={disabled}
            />
          </label>
          <label className="api-settings-field">
            <span>
              {t("settings.apiMaxContext", {
                defaultValue: "Max context (tokens)",
              })}
            </span>
            <input
              value={data.maxContextTokens}
              onChange={ch("maxContextTokens")}
              placeholder="e.g. 128000"
              type="number"
              min={0}
              disabled={disabled}
            />
          </label>
          <label className="api-settings-field">
            <span>
              {t("settings.apiMaxTokens", { defaultValue: "Max tokens" })}
            </span>
            <input
              value={data.maxTokens}
              onChange={ch("maxTokens")}
              placeholder="e.g. 4096"
              type="number"
              min={0}
              disabled={disabled}
            />
          </label>
        </div>
      </div>

      {/* ── Vision ── */}
      <div className="api-settings-form-section">
        <div className="api-settings-form-section-header">
          <strong className="api-settings-form-section-title">
            {t("settings.formVision", { defaultValue: "Vision" })}
          </strong>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={data.supportsVision}
              onChange={ch("supportsVision")}
              disabled={disabled}
              hidden
            />
            <span className="toggle-slider" />
            <span>
              {t("settings.apiSupportsVision", {
                defaultValue: "Supports vision",
              })}
            </span>
          </label>
        </div>
        {!data.supportsVision && (
          <div className="api-settings-form-grid">
            <label className="api-settings-field wide">
              <span>
                {t("settings.apiVisionBaseUrl", {
                  defaultValue: "Vision Base URL",
                })}
              </span>
              <input
                value={data.visionBaseUrl}
                onChange={ch("visionBaseUrl")}
                placeholder={DEFAULT_API_BASE_URL}
                disabled={disabled}
              />
            </label>
            <label className="api-settings-field">
              <span>
                {t("settings.apiVisionApiKey", {
                  defaultValue: "Vision API key",
                })}
              </span>
              <div className="api-settings-password-wrap">
                <input
                  value={data.visionApiKey}
                  onChange={ch("visionApiKey")}
                  placeholder="sk-..."
                  type={showVisionKey ? "text" : "password"}
                  disabled={disabled}
                />
                <button
                  type="button"
                  className="api-settings-password-toggle"
                  onClick={() => setShowVisionKey((v) => !v)}
                  tabIndex={-1}
                >
                  {showVisionKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </label>
            <label className="api-settings-field">
              <span>
                {t("settings.apiVisionRequestMethod", {
                  defaultValue: "Vision method",
                })}
              </span>
              <select
                value={data.visionRequestMethod}
                onChange={ch("visionRequestMethod")}
                disabled={disabled}
              >
                {REQUEST_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label className="api-settings-field">
              <span>
                {t("settings.apiVisionModel", { defaultValue: "Vision model" })}
              </span>
              <input
                value={data.visionModel}
                onChange={ch("visionModel")}
                placeholder="gpt-4.1"
                disabled={disabled}
              />
            </label>
          </div>
        )}
      </div>

      {/* ── Runtime ── */}
      <div className="api-settings-form-section">
        <strong className="api-settings-form-section-title">
          {t("settings.formRuntime", { defaultValue: "Runtime" })}
        </strong>
        <div className="api-settings-form-grid">
          <label className="api-settings-field">
            <span>
              {t("settings.apiStreamIdleTimeout", {
                defaultValue: "Stream idle timeout (s)",
              })}
            </span>
            <input
              value={data.streamIdleTimeoutSec}
              onChange={ch("streamIdleTimeoutSec")}
              placeholder="e.g. 60"
              type="number"
              min={0}
              disabled={disabled}
            />
          </label>
          <label className="api-settings-field">
            <span>
              {t("settings.apiSetActive", {
                defaultValue: "Enable profile",
              })}
            </span>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={data.isActive}
                onChange={ch("isActive")}
                disabled={disabled}
                hidden
              />
              <span className="toggle-slider" />
              <span>
                {data.isActive
                  ? t("settings.active", { defaultValue: ENABLED_STATUS_LABEL })
                  : t("settings.inactive", {
                      defaultValue: DISABLED_STATUS_LABEL,
                    })}
              </span>
            </label>
          </label>
        </div>
      </div>
    </div>
  );
}

function toPayload(
  data: ApiConfigFormData,
  isActive: boolean,
  configCount: number
): ApiConfigInput {
  const profileName = data.profileName.trim();
  const displayName = data.displayName.trim() || profileName;
  const baseUrl = data.baseUrl.trim() || DEFAULT_API_BASE_URL;
  const requestMethod = data.requestMethod.trim() || DEFAULT_REQUEST_METHOD;
  const advancedModel = data.advancedModel.trim();
  const basicModel = data.basicModel.trim();
  const visionRequestMethod = data.visionRequestMethod.trim() || requestMethod;
  const configJson = JSON.stringify({
    snowcfg: {
      baseUrl,
      baseUrlMode: data.baseUrlMode,
      requestMethod,
      advancedModel,
      basicModel,
      supportsVision: data.supportsVision,
    },
  });

  return {
    profileName,
    displayName,
    isActive: isActive || configCount === 0,
    baseUrl,
    baseUrlMode: data.baseUrlMode || "auto",
    apiKey: data.apiKey,
    requestMethod,
    advancedModel,
    basicModel,
    supportsVision: data.supportsVision,
    visionBaseUrl: data.visionBaseUrl.trim(),
    visionBaseUrlMode: "auto",
    visionApiKey: data.visionApiKey,
    visionRequestMethod,
    visionModel: data.visionModel.trim(),
    maxContextTokens: parseNum(data.maxContextTokens),
    maxTokens: parseNum(data.maxTokens),
    streamIdleTimeoutSec: parseNum(data.streamIdleTimeoutSec),
    configJson,
    source: "manual",
  };
}

export function ApiSettingsTreePanel({
  onClose,
}: ApiSettingsPanelProps): React.JSX.Element {
  const { t } = useI18n();
  const [configs, setConfigs] = useState<ApiConfigRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<ApiConfigFormData>(() =>
    emptyForm(1, true)
  );
  const [editingProfileName, setEditingProfileName] = useState<string | null>(
    null
  );
  const [editForm, setEditForm] = useState<ApiConfigFormData | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const activeConfig = configs.find((c) => c.isActive) ?? configs[0];
  const isBusy = isLoading || isSaving;

  const load = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const list = await window.snow.listApiConfigs();
      setConfigs(list);
      setAddForm(emptyForm(list.length + 1, list.length === 0));
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : t("settings.apiLoadError", {
              defaultValue: "Failed to load API configs",
            })
      );
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const onFieldChange =
    (form: "add" | "edit") =>
    (field: keyof ApiConfigFormData, value: string | boolean) => {
      if (field === "isActive" && value === false) {
        const currentForm = form === "add" ? addForm : editForm;
        const profileName = currentForm?.profileName;
        const willKeepAnotherActive = configs.some(
          (config) => config.isActive && config.profileName !== profileName
        );

        if (!willKeepAnotherActive) {
          setError(
            t("settings.apiAtLeastOneActive", {
              defaultValue: "At least one API profile must be enabled.",
            })
          );
          return;
        }
      }

      if (form === "add") setAddForm((p) => ({ ...p, [field]: value }));
      else if (form === "edit" && editForm)
        setEditForm({ ...editForm, [field]: value });
    };

  // ── Add ──
  const handleAddSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!addForm.profileName.trim()) {
      setError(
        t("settings.apiManualProfileRequired", {
          defaultValue: "Profile name is required.",
        })
      );
      return;
    }
    setIsSaving(true);
    setError("");
    setStatus("");
    try {
      const list = await window.snow.upsertApiConfig(
        toPayload(addForm, addForm.isActive, configs.length)
      );
      setConfigs(list);
      setAddForm(emptyForm(list.length + 1, false));
      setShowAddForm(false);
      setStatus(
        t("settings.apiManualAddSuccess", {
          defaultValue: "Added API profile {name}.",
        }).replace("{name}", addForm.profileName.trim())
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : t("settings.apiAddError", {
              defaultValue: "Failed to add API config",
            })
      );
    } finally {
      setIsSaving(false);
    }
  };

  const toggleAddForm = () => {
    setError("");
    setStatus("");
    setShowAddForm((v) => {
      if (!v) setAddForm(emptyForm(configs.length + 1, configs.length === 0));
      return !v;
    });
  };

  // ── Import ──
  const handleImport = async () => {
    setIsLoading(true);
    setError("");
    setStatus("");
    try {
      const r = await window.snow.importSnowCliApiConfigs();
      setConfigs(r.configs);
      setAddForm(emptyForm(r.configs.length + 1, r.configs.length === 0));
      setStatus(
        t("settings.apiImportSuccess", {
          defaultValue: "Imported {count} Snow CLI profiles.",
        }).replace("{count}", r.importedCount.toString())
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : t("settings.apiImportError", {
              defaultValue: "Failed to import Snow CLI configs",
            })
      );
    } finally {
      setIsLoading(false);
    }
  };

  // ── Delete ──
  const handleDelete = async (profileName: string, displayName: string) => {
    setError("");
    setStatus("");
    try {
      const list = await window.snow.deleteApiConfig(profileName);
      setConfigs(list);
      setEditingProfileName(null);
      setEditForm(null);
      setStatus(
        t("settings.apiDeleteSuccess", {
          defaultValue: "Deleted API profile {name}.",
        }).replace("{name}", displayName)
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : t("settings.apiDeleteError", {
              defaultValue: "Failed to delete API config",
            })
      );
    }
  };

  // ── Edit ──
  const handleStartEdit = (config: ApiConfigRecord) => {
    setEditingProfileName(config.profileName);
    setShowAddForm(false);
    setError("");
    setStatus("");
    setEditForm({
      profileName: config.profileName,
      displayName: config.displayName,
      baseUrl: config.baseUrl || DEFAULT_API_BASE_URL,
      baseUrlMode: config.baseUrlMode || "auto",
      apiKey: config.apiKey || "",
      requestMethod: config.requestMethod || DEFAULT_REQUEST_METHOD,
      advancedModel: config.advancedModel || "",
      basicModel: config.basicModel || "",
      isActive: config.isActive,
      supportsVision: config.supportsVision,
      visionBaseUrl: config.visionBaseUrl || "",
      visionApiKey: config.visionApiKey || "",
      visionRequestMethod: config.visionRequestMethod || DEFAULT_REQUEST_METHOD,
      visionModel: config.visionModel || "",
      maxContextTokens:
        config.maxContextTokens != null ? String(config.maxContextTokens) : "",
      maxTokens: config.maxTokens != null ? String(config.maxTokens) : "",
      streamIdleTimeoutSec:
        config.streamIdleTimeoutSec != null
          ? String(config.streamIdleTimeoutSec)
          : "",
    });
  };

  const handleSaveEdit = async () => {
    if (!editForm) return;
    setIsSaving(true);
    setError("");
    setStatus("");
    try {
      const list = await window.snow.upsertApiConfig(
        toPayload(editForm, editForm.isActive, configs.length)
      );
      setConfigs(list);
      setEditingProfileName(null);
      setEditForm(null);
      setStatus(
        t("settings.apiEditSuccess", {
          defaultValue: "Updated API profile {name}.",
        }).replace("{name}", editForm.profileName)
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : t("settings.apiUpdateError", {
              defaultValue: "Failed to update API config",
            })
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setEditingProfileName(null);
    setEditForm(null);
  };

  // ── Toggle active ──
  const handleToggleActive = async (config: ApiConfigRecord) => {
    if (config.isActive) return;
    setError("");
    setStatus("");
    try {
      const list = await window.snow.upsertApiConfig({
        profileName: config.profileName,
        displayName: config.displayName,
        isActive: true,
        baseUrl: config.baseUrl,
        baseUrlMode: config.baseUrlMode,
        apiKey: "",
        requestMethod: config.requestMethod,
        advancedModel: config.advancedModel,
        basicModel: config.basicModel,
        supportsVision: config.supportsVision,
        visionBaseUrl: config.visionBaseUrl,
        visionBaseUrlMode: "auto",
        visionApiKey: "",
        visionRequestMethod: config.visionRequestMethod,
        visionModel: config.visionModel,
        maxContextTokens: null,
        maxTokens: null,
        streamIdleTimeoutSec: null,
        configJson: "{}",
        source: config.source,
      });
      setConfigs(list);
      setStatus(
        t("settings.apiActivateSuccess", {
          defaultValue: "Activated {name}.",
        }).replace("{name}", config.displayName)
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : t("settings.apiActivateError", {
              defaultValue: "Failed to activate API config",
            })
      );
    }
  };

  return (
    <div className="api-settings-page" role="region">
      {/* ── Header ── */}
      <div className="api-settings-page-header">
        <div className="api-settings-title-group">
          <span className="api-settings-kicker">
            {t("settings.apiTreeKicker", {
              defaultValue: "Snow CLI compatible",
            })}
          </span>
          <strong>
            {t("settings.apiTreeTitle", { defaultValue: "API configuration" })}
          </strong>
        </div>
        {onClose && (
          <button
            className="icon-btn ghost"
            onClick={onClose}
            type="button"
            aria-label={t("settings.closeApiSettings", {
              defaultValue: "Close API settings",
            })}
            title={t("settings.closeApiSettings", {
              defaultValue: "Close API settings",
            })}
          >
            <X size={15} strokeWidth={1.8} />
          </button>
        )}
      </div>

      {/* ── Summary ── */}
      <div className="api-settings-summary-grid">
        <div className="api-settings-summary-card">
          <Database size={15} strokeWidth={1.8} />
          <span>{configs.length}</span>
          <small>
            {t("settings.apiProfiles", { defaultValue: "Profiles" })}
          </small>
        </div>
        <div className="api-settings-summary-card wide">
          <Server size={15} strokeWidth={1.8} />
          <span>{activeConfig?.requestMethod ?? "-"}</span>
          <small>
            {activeConfig?.baseUrl ||
              t("settings.noActiveApi", { defaultValue: "No active API" })}
          </small>
        </div>
        <div className="api-settings-summary-card">
          <Sparkles size={15} strokeWidth={1.8} />
          <span>{activeConfig?.advancedModel || "-"}</span>
          <small>
            {t("settings.apiPrimaryModel", { defaultValue: "Primary model" })}
          </small>
        </div>
      </div>

      {/* ── Actions ── */}
      <div className="api-settings-actions">
        <button
          className="api-settings-action-btn primary"
          onClick={() => void handleImport()}
          type="button"
          disabled={isBusy}
        >
          {isLoading ? (
            <Loader2 size={15} className="spin" />
          ) : (
            <Download size={15} />
          )}
          <span>
            {t("settings.importFromSnowCli", {
              defaultValue: "Sync Snow CLI API config",
            })}
          </span>
        </button>
        <button
          className="api-settings-action-btn secondary"
          onClick={toggleAddForm}
          type="button"
          disabled={isBusy}
        >
          <Plus size={15} />
          <span>
            {showAddForm
              ? t("settings.cancelManualApiConfig", {
                  defaultValue: "Cancel manual add",
                })
              : t("settings.addManualApiConfig", {
                  defaultValue: "Add manually",
                })}
          </span>
        </button>
      </div>

      {/* ── Add form ── */}
      {showAddForm && (
        <form className="api-settings-manual-form" onSubmit={handleAddSubmit}>
          <div className="api-settings-manual-header">
            <strong>
              {t("settings.apiManualFormTitle", {
                defaultValue: "Manual API profile",
              })}
            </strong>
            <span>
              {t("settings.apiManualFormInfo", {
                defaultValue:
                  "Add a provider without importing Snow CLI profiles.",
              })}
            </span>
          </div>
          <FormFields
            data={addForm}
            onChange={onFieldChange("add")}
            disabled={isSaving}
            isNew
          />
          <div className="api-settings-form-actions">
            <button
              className="api-settings-form-btn secondary"
              onClick={toggleAddForm}
              type="button"
              disabled={isSaving}
            >
              {t("settings.cancel", { defaultValue: "Cancel" })}
            </button>
            <button
              className="api-settings-form-btn primary"
              type="submit"
              disabled={isSaving}
            >
              {isSaving ? (
                <Loader2 size={15} className="spin" />
              ) : (
                <Save size={15} strokeWidth={1.9} />
              )}
              <span>
                {t("settings.saveApiConfig", {
                  defaultValue: "Save API profile",
                })}
              </span>
            </button>
          </div>
        </form>
      )}

      {/* ── Edit panel ── */}
      {editingProfileName && editForm && (
        <div className="api-settings-edit-panel">
          <div className="api-settings-manual-header">
            <strong>
              {t("settings.apiEditTitle", { defaultValue: "Edit profile" })}:{" "}
              {editForm.profileName}
            </strong>
            <span>
              {t("settings.apiEditInfo", {
                defaultValue: "Leave API key blank to keep the existing value.",
              })}
            </span>
          </div>
          <FormFields
            data={editForm}
            onChange={onFieldChange("edit")}
            disabled={isSaving}
            isNew={false}
          />
          <div className="api-settings-form-actions">
            <button
              className="api-settings-form-btn secondary"
              onClick={handleCancelEdit}
              type="button"
              disabled={isSaving}
            >
              {t("settings.cancel", { defaultValue: "Cancel" })}
            </button>
            <button
              className="api-settings-form-btn primary"
              onClick={() => void handleSaveEdit()}
              type="button"
              disabled={isSaving}
            >
              {isSaving ? (
                <Loader2 size={15} className="spin" />
              ) : (
                <Save size={15} strokeWidth={1.9} />
              )}
              <span>
                {t("settings.saveApiConfig", {
                  defaultValue: "Save API profile",
                })}
              </span>
            </button>
          </div>
        </div>
      )}

      <AutoDismissNotice
        message={error || status}
        tone={error ? "error" : "success"}
        onDismiss={() => {
          setError("");
          setStatus("");
        }}
      />

      {/* ── Table ── */}
      <div
        className="api-settings-table-wrap"
        aria-label={t("settings.apiConfigTable", {
          defaultValue: "API configuration table",
        })}
      >
        {isLoading && configs.length === 0 ? (
          <div className="api-settings-empty">
            <Loader2 size={16} className="spin" />
            {t("settings.loadingApiConfigs", {
              defaultValue: "Loading API configs...",
            })}
          </div>
        ) : configs.length === 0 ? (
          <div className="api-settings-empty">
            {t("settings.noApiConfigs", {
              defaultValue:
                "No API profiles yet. Import Snow CLI profiles or add one manually.",
            })}
          </div>
        ) : (
          <table className="api-settings-table">
            <thead>
              <tr>
                <th>{t("settings.tableName", { defaultValue: "Name" })}</th>
                <th>
                  {t("settings.tableBaseUrl", { defaultValue: "Base URL" })}
                </th>
                <th>{t("settings.tableModel", { defaultValue: "Model" })}</th>
                <th>{t("settings.tableMethod", { defaultValue: "Method" })}</th>
                <th>{t("settings.tableStatus", { defaultValue: "Status" })}</th>
                <th className="api-settings-table-actions-col">
                  {t("settings.tableActions", { defaultValue: "Actions" })}
                </th>
              </tr>
            </thead>
            <tbody>
              {configs.map((config) => (
                <tr key={config.profileName}>
                  <td className="cell-name">
                    <strong>{config.displayName}</strong>
                    <small className="profile-name-hint">
                      {config.profileName}
                    </small>
                  </td>
                  <td className="cell-url">{config.baseUrl || "-"}</td>
                  <td>{config.advancedModel || config.basicModel || "-"}</td>
                  <td>
                    <span className="badge method">{config.requestMethod}</span>
                  </td>
                  <td>
                    <button
                      className={
                        config.isActive
                          ? "badge active clickable"
                          : "badge inactive clickable"
                      }
                      onClick={() => void handleToggleActive(config)}
                      type="button"
                      disabled={config.isActive}
                      title={
                        config.isActive
                          ? t("settings.activeProfile", {
                              defaultValue: "Enabled profile",
                            })
                          : t("settings.clickToActivate", {
                              defaultValue: "Click to enable this profile",
                            })
                      }
                    >
                      {config.isActive
                        ? t("settings.active", {
                            defaultValue: ENABLED_STATUS_LABEL,
                          })
                        : t("settings.inactive", {
                            defaultValue: DISABLED_STATUS_LABEL,
                          })}
                    </button>
                  </td>
                  <td className="api-settings-table-actions-col">
                    <div className="api-settings-table-actions">
                      <button
                        className="icon-btn ghost"
                        onClick={() => handleStartEdit(config)}
                        type="button"
                        title={t("settings.edit", { defaultValue: "Edit" })}
                        aria-label={t("settings.edit", {
                          defaultValue: "Edit",
                        })}
                      >
                        <Pencil size={13} strokeWidth={1.8} />
                      </button>
                      <button
                        className="icon-btn ghost danger"
                        onClick={() =>
                          void handleDelete(
                            config.profileName,
                            config.displayName
                          )
                        }
                        type="button"
                        title={t("settings.delete", { defaultValue: "Delete" })}
                        aria-label={t("settings.delete", {
                          defaultValue: "Delete",
                        })}
                      >
                        <Trash2 size={13} strokeWidth={1.8} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
