import { Loader2, Save, X } from "lucide-react";
import { useI18n } from "../../../i18n";
import type { PromptDraft } from "./types";

type SystemPromptEditorProps = {
  draft: PromptDraft;
  isBusy: boolean;
  isSaving: boolean;
  onNameChange: (name: string) => void;
  onContentChange: (content: string) => void;
  onCancel: () => void;
  onSave: () => void;
};

export function SystemPromptEditor({
  draft,
  isBusy,
  isSaving,
  onNameChange,
  onContentChange,
  onCancel,
  onSave,
}: SystemPromptEditorProps): React.JSX.Element {
  const { t } = useI18n();

  return (
    <>
      <div className="api-settings-form-grid">
        <label className="api-settings-field">
          <span>
            {t("settings.systemPromptName", {
              defaultValue: "Prompt name",
            })}
          </span>
          <input
            value={draft.name}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder={t("settings.systemPromptNamePlaceholder", {
              defaultValue: "e.g. Coding assistant",
            })}
            disabled={isBusy}
          />
        </label>
        <label className="api-settings-field wide">
          <span>
            {t("settings.systemPromptContent", {
              defaultValue: "Prompt content",
            })}
          </span>
          <textarea
            className="system-prompt-textarea"
            rows={6}
            value={draft.content}
            onChange={(event) => onContentChange(event.target.value)}
            placeholder={t("settings.systemPromptContentPlaceholder", {
              defaultValue: "Enter the system prompt content...",
            })}
            disabled={isBusy}
          />
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
            {t("settings.saveSystemPrompt", {
              defaultValue: "Save prompt",
            })}
          </span>
        </button>
      </div>
    </>
  );
}
