import { Loader2, Save, X } from "lucide-react";
import { useI18n } from "../../../i18n";
import type { SensitiveCommandDraft } from "./types";

type SensitiveCommandEditorProps = {
  draft: SensitiveCommandDraft;
  isBusy: boolean;
  isSaving: boolean;
  onDraftChange: (patch: Partial<SensitiveCommandDraft>) => void;
  onCancel: () => void;
  onSave: () => void;
};

export function SensitiveCommandEditor({
  draft,
  isBusy,
  isSaving,
  onDraftChange,
  onCancel,
  onSave,
}: SensitiveCommandEditorProps): React.JSX.Element {
  const { t } = useI18n();

  return (
    <>
      <div className="api-settings-form-grid">
        <label className="api-settings-field wide">
          <span>
            {t("settings.sensitiveCommandPattern", {
              defaultValue: "Command pattern",
            })}
          </span>
          <input
            value={draft.pattern}
            onChange={(event) => onDraftChange({ pattern: event.target.value })}
            placeholder="git reset*--hard"
            disabled={isBusy || draft.isPreset}
          />
        </label>
        <label className="api-settings-field wide">
          <span>
            {t("settings.sensitiveCommandDescription", {
              defaultValue: "Description",
            })}
          </span>
          <input
            value={draft.description}
            onChange={(event) =>
              onDraftChange({ description: event.target.value })
            }
            placeholder={t("settings.sensitiveCommandDescriptionPlaceholder", {
              defaultValue: "Explain why this command needs approval",
            })}
            disabled={isBusy}
          />
        </label>
        <label className="api-settings-field">
          <span>
            {t("settings.sensitiveCommandScope", { defaultValue: "Scope" })}
          </span>
          <select
            value={draft.scope}
            onChange={(event) => onDraftChange({ scope: event.target.value })}
            disabled={isBusy || draft.isPreset}
          >
            <option value="global">
              {t("settings.sensitiveCommandScopeGlobal", {
                defaultValue: "Global",
              })}
            </option>
            <option value="project">
              {t("settings.sensitiveCommandScopeProject", {
                defaultValue: "Project",
              })}
            </option>
          </select>
        </label>
        <label className="toggle-switch mcp-enabled-switch">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) =>
              onDraftChange({ enabled: event.target.checked })
            }
            disabled={isBusy}
          />
          <span className="toggle-slider" />
          <span>
            {t("settings.sensitiveCommandEnabled", {
              defaultValue: "Enable rule",
            })}
          </span>
        </label>
      </div>

      <div className="api-settings-form-actions">
        <button
          className="api-settings-form-btn secondary"
          onClick={onCancel}
          type="button"
          disabled={isBusy}
        >
          <X size={15} strokeWidth={1.9} />
          <span>{t("settings.cancel", { defaultValue: "Cancel" })}</span>
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
            {t("settings.saveSensitiveCommand", { defaultValue: "Save rule" })}
          </span>
        </button>
      </div>
    </>
  );
}
