import { Loader2, RotateCcw, Save } from "lucide-react";
import { type ChangeEvent } from "react";
import { useI18n } from "../../../i18n";
import { FONT_WEIGHT_OPTIONS } from "./terminalSettingsConstants";
import { TerminalCombobox } from "./TerminalCombobox";
import type {
  DetectedTerminalOption,
  TerminalSettingsForm as TerminalSettingsFormValue,
} from "./types";

type TerminalSettingsFormProps = {
  form: TerminalSettingsFormValue;
  isBusy: boolean;
  isSaving: boolean;
  isSelectingExecutable: boolean;
  detectedTerminals: DetectedTerminalOption[];
  onUpdateField: (
    field: keyof TerminalSettingsFormValue
  ) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
  onShellPathChange: (value: string) => void;
  onReset: () => void;
  onSave: () => void;
  onSelectExecutable: () => void;
};

export function TerminalSettingsForm({
  form,
  isBusy,
  isSaving,
  isSelectingExecutable,
  detectedTerminals,
  onUpdateField,
  onShellPathChange,
  onReset,
  onSave,
  onSelectExecutable,
}: TerminalSettingsFormProps): React.JSX.Element {
  const { t } = useI18n();

  return (
    <div className="api-settings-manual-form">
      <div className="api-settings-manual-header">
        <strong>
          {t("settings.terminalManualTitle", {
            defaultValue: "Manual configuration",
          })}
        </strong>
        <span>
          {t("settings.terminalManualInfo", {
            defaultValue:
              "These values are saved in Snow App system settings and used when launching the integrated terminal.",
          })}
        </span>
      </div>

      <div className="api-settings-form-body">
        {/* ===== Shell ===== */}
        <div className="api-settings-form-section">
          <div className="api-settings-form-section-header">
            <strong className="api-settings-form-section-title">
              {t("settings.terminalSectionShell", { defaultValue: "Shell" })}
            </strong>
          </div>

          <div className="api-settings-form-grid">
            <TerminalCombobox
              value={form.shellPath}
              placeholder={t("settings.terminalShellPathPlaceholder", {
                defaultValue: "Leave empty to auto-detect",
              })}
              disabled={isBusy}
              isSelectingExecutable={isSelectingExecutable}
              detectedTerminals={detectedTerminals}
              browseLabel={t("settings.terminalSelectExecutable", {
                defaultValue: "Browse",
              })}
              emptyText={t("settings.terminalNoDetectedTerminals", {
                defaultValue: "No terminals detected",
              })}
              onChange={onShellPathChange}
              onBrowse={onSelectExecutable}
            />
          </div>
        </div>

        {/* ===== Font ===== */}
        <div className="api-settings-form-section">
          <div className="api-settings-form-section-header">
            <strong className="api-settings-form-section-title">
              {t("settings.terminalSectionFont", { defaultValue: "Font" })}
            </strong>
          </div>

          <div className="api-settings-form-grid">
            <label className="api-settings-field wide">
              <span>
                {t("settings.terminalFontFamily", { defaultValue: "Font family" })}
              </span>
              <input
                value={form.fontFamily}
                onChange={onUpdateField("fontFamily")}
                placeholder={t("settings.terminalFontFamilyPlaceholder", {
                  defaultValue: "e.g. Consolas, Monaco, monospace",
                })}
                disabled={isBusy}
              />
            </label>
            <label className="api-settings-field">
              <span>
                {t("settings.terminalFontSize", { defaultValue: "Font size" })}
              </span>
              <input
                value={form.fontSize}
                onChange={onUpdateField("fontSize")}
                type="number"
                min={6}
                max={72}
                disabled={isBusy}
              />
            </label>
            <label className="api-settings-field">
              <span>
                {t("settings.terminalFontWeight", { defaultValue: "Font weight" })}
              </span>
              <select
                value={form.fontWeight}
                onChange={onUpdateField("fontWeight")}
                disabled={isBusy}
              >
                {FONT_WEIGHT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="api-settings-field">
              <span>
                {t("settings.terminalLineHeight", { defaultValue: "Line height" })}
              </span>
              <input
                value={form.lineHeight}
                onChange={onUpdateField("lineHeight")}
                type="number"
                min={0.5}
                max={3}
                step={0.1}
                disabled={isBusy}
              />
            </label>
          </div>
        </div>

        {/* ===== Network ===== */}
        <div className="api-settings-form-section">
          <div className="api-settings-form-section-header">
            <strong className="api-settings-form-section-title">
              {t("settings.terminalSectionNetwork", { defaultValue: "Network" })}
            </strong>
          </div>

          <div className="api-settings-form-grid">
            <label className="api-settings-field wide">
              <span>
                {t("settings.terminalProxy", { defaultValue: "Proxy" })}
              </span>
              <input
                value={form.proxy}
                onChange={onUpdateField("proxy")}
                placeholder={t("settings.terminalProxyPlaceholder", {
                  defaultValue:
                    "e.g. http://127.0.0.1:7890 (leave empty for none)",
                })}
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
        <button
          className="api-settings-form-btn primary"
          onClick={onSave}
          type="button"
          disabled={isBusy}
        >
          {isSaving ? (
            <Loader2 size={15} className="spin" />
          ) : (
            <Save size={15} strokeWidth={1.9} />
          )}
          <span>
            {t("settings.saveTerminalSettings", { defaultValue: "Save settings" })}
          </span>
        </button>
      </div>
    </div>
  );
}
