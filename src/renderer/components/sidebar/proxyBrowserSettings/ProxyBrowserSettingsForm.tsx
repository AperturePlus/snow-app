import { FolderOpen, Loader2, RotateCcw } from "lucide-react";
import { type ChangeEvent } from "react";
import { useI18n } from "../../../i18n";
import { CustomSelect } from "../../common/CustomSelect";
import { SEARCH_ENGINE_OPTIONS } from "./proxyBrowserSettingsConstants";
import type { ProxyBrowserSettingsForm as ProxyBrowserSettingsFormValue } from "./types";

type ProxyBrowserSettingsFormProps = {
  form: ProxyBrowserSettingsFormValue;
  isBusy: boolean;
  isSelectingBrowser: boolean;
  onUpdateField: (
    field: keyof ProxyBrowserSettingsFormValue
  ) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
  onSetValue: (
    field: keyof ProxyBrowserSettingsFormValue,
    value: string
  ) => void;
  onReset: () => void;
  onSelectBrowserExecutable: () => void;
};

export function ProxyBrowserSettingsForm({
  form,
  isBusy,
  isSelectingBrowser,
  onUpdateField,
  onSetValue,
  onReset,
  onSelectBrowserExecutable,
}: ProxyBrowserSettingsFormProps): React.JSX.Element {
  const { t } = useI18n();

  return (
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
                onChange={onUpdateField("enabled")}
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
                onChange={onUpdateField("port")}
                placeholder="7890"
                type="number"
                min={1}
                max={65535}
                disabled={isBusy}
              />
            </label>
            <label className="api-settings-field">
              <span>
                {t("settings.searchEngine", { defaultValue: "Search engine" })}
              </span>
              <CustomSelect
                value={form.searchEngine}
                options={SEARCH_ENGINE_OPTIONS}
                onChange={(value) => onSetValue("searchEngine", value)}
                disabled={isBusy}
              />
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
                  onChange={onUpdateField("browserPath")}
                  placeholder={t("settings.browserPathPlaceholder", {
                    defaultValue:
                      "Leave empty to auto-detect Chrome / Edge / Chromium",
                  })}
                  disabled={isBusy}
                />
                <button
                  className="api-settings-inline-btn"
                  onClick={onSelectBrowserExecutable}
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
                onChange={onUpdateField("browserDebugPort")}
                placeholder="9222"
                type="number"
                min={1}
                max={65535}
                disabled={isBusy}
              />
            </label>
          </div>
        </div>
      </div>

      <div className="api-settings-form-actions">
        <button
          className="api-settings-form-btn secondary"
          onClick={onReset}
          type="button"
          disabled={isBusy}
        >
          <RotateCcw size={15} strokeWidth={1.9} />
          <span>{t("settings.reset", { defaultValue: "Reset" })}</span>
        </button>
      </div>
    </div>
  );
}
