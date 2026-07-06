import { X } from "lucide-react";
import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import { AutoDismissNotice } from "../AutoDismissNotice";
import { useI18n } from "../../i18n";
import { TerminalSettingsForm } from "./terminalSettings/TerminalSettingsForm";
import { TerminalSettingsSummary } from "./terminalSettings/TerminalSettingsSummary";
import {
  DEFAULT_TERMINAL_SETTINGS,
  TERMINAL_SETTING_CODE,
  TERMINAL_SETTING_NAME,
} from "./terminalSettings/terminalSettingsConstants";
import {
  readTerminalSettingsJson,
  toTerminalForm,
  toTerminalSettings,
} from "./terminalSettings/terminalSettingsUtils";
import { notifyTerminalSettingsChanged } from "../rightPanel/useTerminalSettings";
import type {
  DetectedTerminalOption,
  TerminalSettingsForm as TerminalSettingsFormValue,
  TerminalSettingsPanelProps,
  TerminalSettingsValue,
} from "./terminalSettings/types";

export function TerminalSettingsPanel({
  onClose,
}: TerminalSettingsPanelProps): React.JSX.Element {
  const { t } = useI18n();
  const [form, setForm] = useState<TerminalSettingsFormValue>(() =>
    toTerminalForm(DEFAULT_TERMINAL_SETTINGS)
  );
  const [lastSaved, setLastSaved] = useState<TerminalSettingsValue>(
    DEFAULT_TERMINAL_SETTINGS
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSelectingExecutable, setIsSelectingExecutable] = useState(false);
  const [detectedTerminals, setDetectedTerminals] = useState<
    DetectedTerminalOption[]
  >([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setIsLoading(true);
    setError("");

    try {
      const [value, terminals] = await Promise.all([
        window.snow.getSystemSettingValue(TERMINAL_SETTING_CODE),
        window.snow.detectTerminals(),
      ]);
      const settings = readTerminalSettingsJson(value);
      setForm(toTerminalForm(settings));
      setLastSaved(settings);
      setDetectedTerminals(terminals);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : t("settings.terminalLoadError", {
              defaultValue: "Failed to load terminal settings",
            })
      );
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const isBusy = isLoading || isSaving || isSelectingExecutable;
  const preview = toTerminalSettings(form);

  const updateField =
    (field: keyof TerminalSettingsFormValue) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const value = event.target.value;
      setForm((previous) => ({ ...previous, [field]: value }));
    };

  const validate = (): string | null => {
    const fontSize = Number.parseFloat(form.fontSize);
    const lineHeight = Number.parseFloat(form.lineHeight);

    if (!Number.isFinite(fontSize) || fontSize < 6 || fontSize > 72) {
      return t("settings.terminalFontSizeValidationError", {
        defaultValue: "Font size must be between 6 and 72.",
      });
    }

    if (!Number.isFinite(lineHeight) || lineHeight < 0.5 || lineHeight > 3) {
      return t("settings.terminalLineHeightValidationError", {
        defaultValue: "Line height must be between 0.5 and 3.",
      });
    }

    return null;
  };

  const saveSettings = async (settings: TerminalSettingsValue) => {
    await window.snow.setSystemSetting(
      TERMINAL_SETTING_NAME,
      TERMINAL_SETTING_CODE,
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

    const settings = toTerminalSettings(form);
    setIsSaving(true);
    setError("");
    setStatus("");

    try {
      await saveSettings(settings);
      setForm(toTerminalForm(settings));
      notifyTerminalSettingsChanged();
      setStatus(
        t("settings.terminalSaveSuccess", {
          defaultValue: "Saved terminal settings.",
        })
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : t("settings.terminalSaveError", {
              defaultValue: "Failed to save terminal settings",
            })
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleSelectExecutable = async () => {
    setIsSelectingExecutable(true);
    setError("");
    setStatus("");

    try {
      const selectedPath = await window.snow.selectTerminalExecutable(
        t("settings.terminalSelectExecutableDialogTitle", {
          defaultValue: "Select terminal executable",
        })
      );

      if (selectedPath) {
        setForm((previous) => ({ ...previous, shellPath: selectedPath }));
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : t("settings.terminalExecutableSelectError", {
              defaultValue: "Failed to select terminal executable",
            })
      );
    } finally {
      setIsSelectingExecutable(false);
    }
  };

  return (
    <div className="api-settings-page" role="region">
      <div className="api-settings-page-header">
        <div className="api-settings-title-group">
          <span className="api-settings-kicker">
            {t("settings.terminalKicker", { defaultValue: "Terminal" })}
          </span>
          <strong>
            {t("settings.terminalTitle", {
              defaultValue: "Terminal settings",
            })}
          </strong>
        </div>
        {onClose && (
          <button
            className="icon-btn ghost"
            onClick={onClose}
            type="button"
            aria-label={t("settings.closeTerminalSettings", {
              defaultValue: "Close terminal settings",
            })}
            title={t("settings.closeTerminalSettings", {
              defaultValue: "Close terminal settings",
            })}
          >
            <X size={15} strokeWidth={1.8} />
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="api-settings-manual-form">
          <div className="api-settings-manual-header">
            <span>
              {t("settings.terminalLoading", {
                defaultValue: "Loading terminal settings...",
              })}
            </span>
          </div>
        </div>
      ) : (
        <>
          <TerminalSettingsSummary preview={preview} />

          <AutoDismissNotice
            message={error || status}
            tone={error ? "error" : "success"}
            onDismiss={() => {
              setError("");
              setStatus("");
            }}
          />

          <TerminalSettingsForm
            form={form}
            isBusy={isBusy}
            isSaving={isSaving}
            isSelectingExecutable={isSelectingExecutable}
            detectedTerminals={detectedTerminals}
            onUpdateField={updateField}
            onShellPathChange={(path) =>
              setForm((previous) => ({ ...previous, shellPath: path }))
            }
            onReset={() => setForm(toTerminalForm(lastSaved))}
            onSave={() => void handleSave()}
            onSelectExecutable={() => void handleSelectExecutable()}
          />
        </>
      )}
    </div>
  );
}
