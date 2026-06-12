import {
  Download,
  FolderOpen,
  Globe,
  Loader2,
  MonitorCog,
  Route,
  Save,
  Search,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import { AutoDismissNotice } from "../AutoDismissNotice";
import { useI18n } from "../../i18n";
import type { ProxyBrowserSettings } from "../../../preload";

type ProxyBrowserSettingsPanelProps = {
  onClose?: () => void;
};

const SETTING_NAME = "Proxy and browser settings";
const SETTING_CODE = "proxy_browser_settings";

const DEFAULT_SETTINGS: ProxyBrowserSettings = {
  enabled: false,
  port: 7890,
  browserPath: "",
  browserDebugPort: 9222,
  searchEngine: "duckduckgo",
};

const SEARCH_ENGINE_OPTIONS = [
  { value: "duckduckgo", label: "DuckDuckGo" },
  { value: "bing", label: "Bing" },
];

const parsePort = (value: string, fallback: number): number => {
  const port = Number.parseInt(value, 10);

  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : fallback;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toText = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const toBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const normalizeSettings = (value: unknown): ProxyBrowserSettings => {
  const source = isRecord(value) ? value : {};

  return {
    enabled: toBoolean(source.enabled, DEFAULT_SETTINGS.enabled),
    port: parsePort(String(source.port ?? ""), DEFAULT_SETTINGS.port),
    browserPath: toText(source.browserPath).trim(),
    browserDebugPort: parsePort(
      String(source.browserDebugPort ?? ""),
      DEFAULT_SETTINGS.browserDebugPort
    ),
    searchEngine:
      toText(source.searchEngine, DEFAULT_SETTINGS.searchEngine).trim() ||
      DEFAULT_SETTINGS.searchEngine,
  };
};

const readSettingsJson = (value: string | null): ProxyBrowserSettings => {
  if (!value) {
    return DEFAULT_SETTINGS;
  }

  try {
    return normalizeSettings(JSON.parse(value) as unknown);
  } catch {
    return DEFAULT_SETTINGS;
  }
};

const toForm = (settings: ProxyBrowserSettings) => ({
  enabled: settings.enabled,
  port: String(settings.port),
  browserPath: settings.browserPath,
  browserDebugPort: String(settings.browserDebugPort),
  searchEngine: settings.searchEngine,
});

type ProxyBrowserSettingsForm = ReturnType<typeof toForm>;

const toSettings = (form: ProxyBrowserSettingsForm): ProxyBrowserSettings => ({
  enabled: form.enabled,
  port: parsePort(form.port, DEFAULT_SETTINGS.port),
  browserPath: form.browserPath.trim(),
  browserDebugPort: parsePort(
    form.browserDebugPort,
    DEFAULT_SETTINGS.browserDebugPort
  ),
  searchEngine: form.searchEngine.trim() || DEFAULT_SETTINGS.searchEngine,
});

export function ProxyBrowserSettingsPanel({
  onClose,
}: ProxyBrowserSettingsPanelProps): React.JSX.Element {
  const { t } = useI18n();
  const [form, setForm] = useState<ProxyBrowserSettingsForm>(() =>
    toForm(DEFAULT_SETTINGS)
  );
  const [lastSaved, setLastSaved] =
    useState<ProxyBrowserSettings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSelectingBrowser, setIsSelectingBrowser] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setIsLoading(true);
    setError("");

    try {
      const value = await window.snow.getSystemSettingValue(SETTING_CODE);
      const settings = readSettingsJson(value);
      setForm(toForm(settings));
      setLastSaved(settings);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : t("settings.proxyBrowserLoadError", {
              defaultValue: "Failed to load proxy and browser settings",
            })
      );
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const isBusy = isLoading || isSaving || isSelectingBrowser;
  const preview = toSettings(form);
  const proxyUrl = preview.enabled ? `http://127.0.0.1:${preview.port}` : "-";
  const browserLabel =
    preview.browserPath ||
    t("settings.autoDetectBrowser", { defaultValue: "Auto detect" });

  const updateField =
    (field: keyof ProxyBrowserSettingsForm) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const value =
        event.target instanceof HTMLInputElement &&
        event.target.type === "checkbox"
          ? event.target.checked
          : event.target.value;

      setForm((previous) => ({ ...previous, [field]: value }));
    };

  const validate = (): string | null => {
    const proxyPort = Number.parseInt(form.port, 10);
    const browserDebugPort = Number.parseInt(form.browserDebugPort, 10);

    if (!Number.isInteger(proxyPort) || proxyPort < 1 || proxyPort > 65535) {
      return t("settings.proxyPortValidationError", {
        defaultValue: "Proxy port must be between 1 and 65535.",
      });
    }

    if (
      !Number.isInteger(browserDebugPort) ||
      browserDebugPort < 1 ||
      browserDebugPort > 65535
    ) {
      return t("settings.browserDebugPortValidationError", {
        defaultValue: "Browser debug port must be between 1 and 65535.",
      });
    }

    return null;
  };

  const saveSettings = async (settings: ProxyBrowserSettings) => {
    await window.snow.setSystemSetting(
      SETTING_NAME,
      SETTING_CODE,
      JSON.stringify(settings)
    );
    setLastSaved(settings);
  };

  const handleSave = async () => {
    const validationError = validate();

    if (validationError) {
      setError(validationError);
      setStatus("");
      return;
    }

    const settings = toSettings(form);
    setIsSaving(true);
    setError("");
    setStatus("");

    try {
      await saveSettings(settings);
      setForm(toForm(settings));
      setStatus(
        t("settings.proxyBrowserSaveSuccess", {
          defaultValue: "Saved proxy and browser settings.",
        })
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : t("settings.proxyBrowserSaveError", {
              defaultValue: "Failed to save proxy and browser settings",
            })
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleImport = async () => {
    setIsLoading(true);
    setError("");
    setStatus("");

    try {
      const settings = await window.snow.importSnowCliProxyConfig();
      const normalized = normalizeSettings(settings);
      setForm(toForm(normalized));
      setLastSaved(normalized);
      setStatus(
        t("settings.proxyBrowserImportSuccess", {
          defaultValue: "Synced proxy settings from Snow CLI.",
        })
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : t("settings.proxyBrowserImportError", {
              defaultValue: "Failed to sync Snow CLI proxy settings",
            })
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectBrowserExecutable = async () => {
    setIsSelectingBrowser(true);
    setError("");
    setStatus("");

    try {
      const selectedPath = await window.snow.selectBrowserExecutable(
        t("settings.selectBrowserExecutableDialogTitle", {
          defaultValue: "Select browser executable",
        })
      );

      if (selectedPath) {
        setForm((previous) => ({ ...previous, browserPath: selectedPath }));
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : t("settings.browserExecutableSelectError", {
              defaultValue: "Failed to select browser executable",
            })
      );
    } finally {
      setIsSelectingBrowser(false);
    }
  };

  return (
    <div className="api-settings-page" role="region">
      <div className="api-settings-page-header">
        <div className="api-settings-title-group">
          <span className="api-settings-kicker">
            {t("settings.proxyBrowserKicker", {
              defaultValue: "Snow CLI compatible",
            })}
          </span>
          <strong>
            {t("settings.proxyBrowserTitle", {
              defaultValue: "Proxy and browser settings",
            })}
          </strong>
        </div>
        {onClose && (
          <button
            className="icon-btn ghost"
            onClick={onClose}
            type="button"
            aria-label={t("settings.closeProxyBrowserSettings", {
              defaultValue: "Close proxy and browser settings",
            })}
            title={t("settings.closeProxyBrowserSettings", {
              defaultValue: "Close proxy and browser settings",
            })}
          >
            <X size={15} strokeWidth={1.8} />
          </button>
        )}
      </div>

      <div className="api-settings-summary-grid">
        <div className="api-settings-summary-card">
          <Globe size={15} strokeWidth={1.8} />
          <span>
            {preview.enabled
              ? t("settings.enabled", { defaultValue: "Enabled" })
              : t("settings.disabled", { defaultValue: "Disabled" })}
          </span>
          <small>{t("settings.proxyStatus", { defaultValue: "Proxy" })}</small>
        </div>
        <div className="api-settings-summary-card wide">
          <Route size={15} strokeWidth={1.8} />
          <span>{proxyUrl}</span>
          <small>
            {t("settings.proxyEndpoint", { defaultValue: "Proxy endpoint" })}
          </small>
        </div>
        <div className="api-settings-summary-card">
          <Search size={15} strokeWidth={1.8} />
          <span>{preview.searchEngine}</span>
          <small>
            {t("settings.searchEngine", { defaultValue: "Search engine" })}
          </small>
        </div>
      </div>

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
            {t("settings.syncSnowCliProxy", {
              defaultValue: "Sync Snow CLI proxy config",
            })}
          </span>
        </button>
      </div>

      <AutoDismissNotice
        message={error || status}
        tone={error ? "error" : "success"}
        onDismiss={() => {
          setError("");
          setStatus("");
        }}
      />

      <div className="api-settings-manual-form">
        <div className="api-settings-manual-header">
          <strong>
            {t("settings.proxyBrowserManualTitle", {
              defaultValue: "Manual configuration",
            })}
          </strong>
          <span>
            {t("settings.proxyBrowserManualInfo", {
              defaultValue:
                "These values are saved in Snow App system settings and can be synced from ~/.snow/proxy-config.json.",
            })}
          </span>
        </div>

        <div className="api-settings-form-body">
          <div className="api-settings-form-section">
            <div className="api-settings-form-section-header">
              <strong className="api-settings-form-section-title">
                {t("settings.formProxy", { defaultValue: "Proxy" })}
              </strong>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={updateField("enabled")}
                  disabled={isBusy}
                  hidden
                />
                <span className="toggle-slider" />
                <span>
                  {form.enabled
                    ? t("settings.enabled", { defaultValue: "Enabled" })
                    : t("settings.disabled", { defaultValue: "Disabled" })}
                </span>
              </label>
            </div>
            <div className="api-settings-form-grid">
              <label className="api-settings-field">
                <span>
                  {t("settings.proxyPort", { defaultValue: "Proxy port" })}
                </span>
                <input
                  value={form.port}
                  onChange={updateField("port")}
                  placeholder="7890"
                  type="number"
                  min={1}
                  max={65535}
                  disabled={isBusy}
                />
              </label>
              <label className="api-settings-field">
                <span>
                  {t("settings.searchEngine", {
                    defaultValue: "Search engine",
                  })}
                </span>
                <select
                  value={form.searchEngine}
                  onChange={updateField("searchEngine")}
                  disabled={isBusy}
                >
                  {SEARCH_ENGINE_OPTIONS.map((engine) => (
                    <option key={engine.value} value={engine.value}>
                      {engine.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="api-settings-form-section">
            <strong className="api-settings-form-section-title">
              {t("settings.formBrowser", { defaultValue: "Browser" })}
            </strong>
            <div className="api-settings-form-grid">
              <label className="api-settings-field wide">
                <span>
                  {t("settings.browserPath", {
                    defaultValue: "Browser executable path",
                  })}
                </span>
                <div className="api-settings-inline-field">
                  <input
                    value={form.browserPath}
                    onChange={updateField("browserPath")}
                    placeholder={t("settings.browserPathPlaceholder", {
                      defaultValue:
                        "Leave empty to auto-detect Chrome / Edge / Chromium",
                    })}
                    disabled={isBusy}
                  />
                  <button
                    className="api-settings-inline-btn"
                    onClick={() => void handleSelectBrowserExecutable()}
                    type="button"
                    disabled={isBusy}
                    aria-label={t("settings.selectBrowserExecutable", {
                      defaultValue: "Browse",
                    })}
                    title={t("settings.selectBrowserExecutable", {
                      defaultValue: "Browse",
                    })}
                  >
                    {isSelectingBrowser ? (
                      <Loader2 size={14} className="spin" />
                    ) : (
                      <FolderOpen size={14} strokeWidth={1.9} />
                    )}
                    <span>
                      {t("settings.selectBrowserExecutable", {
                        defaultValue: "Browse",
                      })}
                    </span>
                  </button>
                </div>
              </label>
              <label className="api-settings-field">
                <span>
                  {t("settings.browserDebugPort", {
                    defaultValue: "Browser debug port",
                  })}
                </span>
                <input
                  value={form.browserDebugPort}
                  onChange={updateField("browserDebugPort")}
                  placeholder="9222"
                  type="number"
                  min={1}
                  max={65535}
                  disabled={isBusy}
                />
              </label>
              <div className="api-settings-summary-card wide proxy-browser-preview-card">
                <MonitorCog size={15} strokeWidth={1.8} />
                <span>{browserLabel}</span>
                <small>
                  {t("settings.browserLaunchMode", {
                    defaultValue: "Browser path",
                  })}
                </small>
              </div>
            </div>
          </div>
        </div>

        <div className="api-settings-form-actions">
          <button
            className="api-settings-form-btn secondary"
            onClick={() => setForm(toForm(lastSaved))}
            type="button"
            disabled={isBusy}
          >
            {t("settings.reset", { defaultValue: "Reset" })}
          </button>
          <button
            className="api-settings-form-btn primary"
            onClick={() => void handleSave()}
            type="button"
            disabled={isBusy}
          >
            {isSaving ? (
              <Loader2 size={15} className="spin" />
            ) : (
              <Save size={15} strokeWidth={1.9} />
            )}
            <span>
              {t("settings.saveProxyBrowserSettings", {
                defaultValue: "Save settings",
              })}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
