import { Download, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import { AutoDismissNotice } from "../AutoDismissNotice";
import { useI18n } from "../../i18n";
import { ProxyBrowserSettingsForm } from "./proxyBrowserSettings/ProxyBrowserSettingsForm";
import { ProxyBrowserSettingsSummary } from "./proxyBrowserSettings/ProxyBrowserSettingsSummary";
import {
  DEFAULT_PROXY_BROWSER_SETTINGS,
  PROXY_BROWSER_SETTING_CODE,
  PROXY_BROWSER_SETTING_NAME,
} from "./proxyBrowserSettings/proxyBrowserSettingsConstants";
import {
  normalizeProxyBrowserSettings,
  readProxyBrowserSettingsJson,
  toProxyBrowserForm,
  toProxyBrowserSettings,
} from "./proxyBrowserSettings/proxyBrowserSettingsUtils";
import type {
  ProxyBrowserSettingsForm as ProxyBrowserSettingsFormValue,
  ProxyBrowserSettingsPanelProps,
  ProxyBrowserSettingsValue,
} from "./proxyBrowserSettings/types";

export function ProxyBrowserSettingsPanel({
  onClose,
}: ProxyBrowserSettingsPanelProps): React.JSX.Element {
  const { t } = useI18n();
  const [form, setForm] = useState<ProxyBrowserSettingsFormValue>(() =>
    toProxyBrowserForm(DEFAULT_PROXY_BROWSER_SETTINGS)
  );
  const [lastSaved, setLastSaved] = useState<ProxyBrowserSettingsValue>(
    DEFAULT_PROXY_BROWSER_SETTINGS
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSelectingBrowser, setIsSelectingBrowser] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setIsLoading(true);
    setError("");

    try {
      const value = await window.snow.getSystemSettingValue(
        PROXY_BROWSER_SETTING_CODE
      );
      const settings = readProxyBrowserSettingsJson(value);
      setForm(toProxyBrowserForm(settings));
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
  const preview = toProxyBrowserSettings(form);

  const updateField =
    (field: keyof ProxyBrowserSettingsFormValue) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const value =
        event.target instanceof HTMLInputElement &&
        event.target.type === "checkbox"
          ? event.target.checked
          : event.target.value;

      setForm((previous) => ({ ...previous, [field]: value }));
    };

  const setValue = (
    field: keyof ProxyBrowserSettingsFormValue,
    value: string
  ) => {
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

  const saveSettings = async (settings: ProxyBrowserSettingsValue) => {
    await window.snow.setSystemSetting(
      PROXY_BROWSER_SETTING_NAME,
      PROXY_BROWSER_SETTING_CODE,
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

    const settings = toProxyBrowserSettings(form);
    setIsSaving(true);
    setError("");
    setStatus("");

    try {
      await saveSettings(settings);
      setForm(toProxyBrowserForm(settings));
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
      const normalized = normalizeProxyBrowserSettings(settings);
      setForm(toProxyBrowserForm(normalized));
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

      <ProxyBrowserSettingsSummary preview={preview} />

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

      <ProxyBrowserSettingsForm
        form={form}
        preview={preview}
        isBusy={isBusy}
        isSaving={isSaving}
        isSelectingBrowser={isSelectingBrowser}
        onUpdateField={updateField}
        onSetValue={setValue}
        onReset={() => setForm(toProxyBrowserForm(lastSaved))}
        onSave={() => void handleSave()}
        onSelectBrowserExecutable={() => void handleSelectBrowserExecutable()}
      />
    </div>
  );
}
