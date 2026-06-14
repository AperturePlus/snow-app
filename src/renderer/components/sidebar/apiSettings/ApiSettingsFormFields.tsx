import { useState, type ChangeEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useI18n } from "../../../i18n";
import {
  DEFAULT_API_BASE_URL,
  DEFAULT_REQUEST_METHOD,
  DISABLED_STATUS_LABEL,
  ENABLED_STATUS_LABEL,
  REQUEST_METHODS,
} from "./apiSettingsConstants";
import type { ApiConfigFormData } from "./types";

type ApiSettingsFormFieldsProps = {
  data: ApiConfigFormData;
  onChange: (field: keyof ApiConfigFormData, value: string | boolean) => void;
  disabled: boolean;
  isNew: boolean;
};

export function ApiSettingsFormFields({
  data,
  onChange,
  disabled,
  isNew,
}: ApiSettingsFormFieldsProps): React.JSX.Element {
  const { t } = useI18n();
  const [showApiKey, setShowApiKey] = useState(false);
  const [showVisionKey, setShowVisionKey] = useState(false);

  const changeField =
    (field: keyof ApiConfigFormData) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const value =
        event.target instanceof HTMLInputElement && event.target.type === "checkbox"
          ? event.target.checked
          : event.target.value;
      onChange(field, value);
    };

  return (
    <div className="api-settings-form-body">
      <div className="api-settings-form-section">
        <strong className="api-settings-form-section-title">
          {t("settings.formBasic", { defaultValue: "Basic" })}
        </strong>
        <div className="api-settings-form-grid">
          {isNew && (
            <label className="api-settings-field">
              <span>{t("settings.apiProfileName", { defaultValue: "Profile name" })}</span>
              <input
                value={data.profileName}
                onChange={changeField("profileName")}
                placeholder="openai"
                required
                disabled={disabled}
              />
            </label>
          )}
          <label className="api-settings-field">
            <span>{t("settings.apiDisplayName", { defaultValue: "Display name" })}</span>
            <input
              value={data.displayName}
              onChange={changeField("displayName")}
              placeholder={data.profileName}
              disabled={disabled}
            />
          </label>
          <label className="api-settings-field wide">
            <span>{t("settings.apiBaseUrl", { defaultValue: "Base URL" })}</span>
            <input
              value={data.baseUrl}
              onChange={changeField("baseUrl")}
              placeholder={DEFAULT_API_BASE_URL}
              disabled={disabled}
            />
          </label>
          <label className="api-settings-field">
            <span>{t("settings.apiBaseUrlMode", { defaultValue: "Base URL mode" })}</span>
            <select
              value={data.baseUrlMode}
              onChange={changeField("baseUrlMode")}
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
                onChange={changeField("apiKey")}
                placeholder="sk-..."
                type={showApiKey ? "text" : "password"}
                disabled={disabled}
              />
              <button
                type="button"
                className="api-settings-password-toggle"
                onClick={() => setShowApiKey((value) => !value)}
                tabIndex={-1}
              >
                {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </label>
          <label className="api-settings-field">
            <span>
              {t("settings.apiRequestMethod", { defaultValue: "Request method" })}
            </span>
            <select
              value={data.requestMethod}
              onChange={changeField("requestMethod")}
              disabled={disabled}
            >
              {REQUEST_METHODS.map((method) => (
                <option key={method} value={method}>
                  {method}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="api-settings-form-section">
        <strong className="api-settings-form-section-title">
          {t("settings.formModels", { defaultValue: "Models" })}
        </strong>
        <div className="api-settings-form-grid">
          <label className="api-settings-field">
            <span>{t("settings.apiAdvancedModel", { defaultValue: "Advanced model" })}</span>
            <input
              value={data.advancedModel}
              onChange={changeField("advancedModel")}
              placeholder="gpt-4.1"
              disabled={disabled}
            />
          </label>
          <label className="api-settings-field">
            <span>{t("settings.apiBasicModel", { defaultValue: "Basic model" })}</span>
            <input
              value={data.basicModel}
              onChange={changeField("basicModel")}
              placeholder="gpt-4.1-mini"
              disabled={disabled}
            />
          </label>
          <label className="api-settings-field">
            <span>{t("settings.apiMaxContext", { defaultValue: "Max context (tokens)" })}</span>
            <input
              value={data.maxContextTokens}
              onChange={changeField("maxContextTokens")}
              placeholder="e.g. 128000"
              type="number"
              min={0}
              disabled={disabled}
            />
          </label>
          <label className="api-settings-field">
            <span>{t("settings.apiMaxTokens", { defaultValue: "Max tokens" })}</span>
            <input
              value={data.maxTokens}
              onChange={changeField("maxTokens")}
              placeholder="e.g. 4096"
              type="number"
              min={0}
              disabled={disabled}
            />
          </label>
        </div>
      </div>

      <div className="api-settings-form-section">
        <div className="api-settings-form-section-header">
          <strong className="api-settings-form-section-title">
            {t("settings.formVision", { defaultValue: "Vision" })}
          </strong>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={data.supportsVision}
              onChange={changeField("supportsVision")}
              disabled={disabled}
              hidden
            />
            <span className="toggle-slider" />
            <span>
              {t("settings.apiSupportsVision", { defaultValue: "Supports vision" })}
            </span>
          </label>
        </div>
        {!data.supportsVision && (
          <div className="api-settings-form-grid">
            <label className="api-settings-field wide">
              <span>{t("settings.apiVisionBaseUrl", { defaultValue: "Vision Base URL" })}</span>
              <input
                value={data.visionBaseUrl}
                onChange={changeField("visionBaseUrl")}
                placeholder={DEFAULT_API_BASE_URL}
                disabled={disabled}
              />
            </label>
            <label className="api-settings-field">
              <span>{t("settings.apiVisionApiKey", { defaultValue: "Vision API key" })}</span>
              <div className="api-settings-password-wrap">
                <input
                  value={data.visionApiKey}
                  onChange={changeField("visionApiKey")}
                  placeholder="sk-..."
                  type={showVisionKey ? "text" : "password"}
                  disabled={disabled}
                />
                <button
                  type="button"
                  className="api-settings-password-toggle"
                  onClick={() => setShowVisionKey((value) => !value)}
                  tabIndex={-1}
                >
                  {showVisionKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </label>
            <label className="api-settings-field">
              <span>{t("settings.apiVisionRequestMethod", { defaultValue: "Vision method" })}</span>
              <select
                value={data.visionRequestMethod}
                onChange={changeField("visionRequestMethod")}
                disabled={disabled}
              >
                {REQUEST_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </select>
            </label>
            <label className="api-settings-field">
              <span>{t("settings.apiVisionModel", { defaultValue: "Vision model" })}</span>
              <input
                value={data.visionModel}
                onChange={changeField("visionModel")}
                placeholder="gpt-4.1"
                disabled={disabled}
              />
            </label>
          </div>
        )}
      </div>

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
              onChange={changeField("streamIdleTimeoutSec")}
              placeholder="e.g. 60"
              type="number"
              min={0}
              disabled={disabled}
            />
          </label>
          <label className="api-settings-field">
            <span>{t("settings.apiSetActive", { defaultValue: "Enable profile" })}</span>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={data.isActive}
                onChange={changeField("isActive")}
                disabled={disabled}
                hidden
              />
              <span className="toggle-slider" />
              <span>
                {data.isActive
                  ? t("settings.active", { defaultValue: ENABLED_STATUS_LABEL })
                  : t("settings.inactive", { defaultValue: DISABLED_STATUS_LABEL })}
              </span>
            </label>
          </label>
        </div>
      </div>
    </div>
  );
}
