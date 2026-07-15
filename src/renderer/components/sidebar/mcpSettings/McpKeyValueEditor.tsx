import { Plus, Trash2 } from "lucide-react";
import { useI18n } from "../../../i18n";
import type { McpKeyValuePair } from "./types";

type McpKeyValueEditorProps = {
  title: string;
  pairs: McpKeyValuePair[];
  isBusy: boolean;
  namePlaceholder: string;
  valuePlaceholder: string;
  onUpdatePair: (pairId: string, field: "key" | "value", value: string) => void;
  onAddPair: () => void;
  onRemovePair: (pairId: string) => void;
};

export function McpKeyValueEditor({
  title,
  pairs,
  isBusy,
  namePlaceholder,
  valuePlaceholder,
  onUpdatePair,
  onAddPair,
  onRemovePair,
}: McpKeyValueEditorProps): React.JSX.Element {
  const { t } = useI18n();

  return (
    <div className="mcp-key-value-editor">
      <div className="api-settings-form-section-header">
        <strong className="api-settings-form-section-title">{title}</strong>
        <button
          className="api-settings-form-btn secondary compact"
          onClick={onAddPair}
          type="button"
          disabled={isBusy}
        >
          <Plus size={14} />
          <span>{t("settings.add", { defaultValue: "Add" })}</span>
        </button>
      </div>

      <div className="custom-headers-editor-list">
        {pairs.length === 0 ? (
          <div className="system-prompt-empty compact">
            {t("settings.mcpNoKeyValues", { defaultValue: "No items" })}
          </div>
        ) : (
          pairs.map((pair) => (
            <div className="custom-headers-editor-row" key={pair.id}>
              <label className="api-settings-field">
                <span>{t("settings.name", { defaultValue: "Name" })}</span>
                <input
                  value={pair.key}
                  onChange={(event) =>
                    onUpdatePair(pair.id, "key", event.target.value)
                  }
                  placeholder={namePlaceholder}
                  disabled={isBusy}
                />
              </label>
              <label className="api-settings-field">
                <span>{t("settings.value", { defaultValue: "Value" })}</span>
                <input
                  value={pair.value}
                  onChange={(event) =>
                    onUpdatePair(pair.id, "value", event.target.value)
                  }
                  placeholder={valuePlaceholder}
                  disabled={isBusy}
                />
              </label>
              <button
                className="icon-btn ghost danger custom-headers-remove-btn"
                onClick={() => onRemovePair(pair.id)}
                type="button"
                aria-label={t("settings.remove", { defaultValue: "Remove" })}
                title={t("settings.remove", { defaultValue: "Remove" })}
                disabled={isBusy}
              >
                <Trash2 size={14} strokeWidth={1.9} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
