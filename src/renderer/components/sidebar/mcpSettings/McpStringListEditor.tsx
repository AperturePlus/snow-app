import { Plus, Trash2 } from "lucide-react";
import { useI18n } from "../../../i18n";
import type { McpStringItem } from "./types";

type McpStringListEditorProps = {
  title: string;
  items: McpStringItem[];
  isBusy: boolean;
  itemLabel: string;
  valuePlaceholder: string;
  emptyMessage: string;
  onUpdateItem: (itemId: string, value: string) => void;
  onAddItem: () => void;
  onRemoveItem: (itemId: string) => void;
};

export function McpStringListEditor({
  title,
  items,
  isBusy,
  itemLabel,
  valuePlaceholder,
  emptyMessage,
  onUpdateItem,
  onAddItem,
  onRemoveItem,
}: McpStringListEditorProps): React.JSX.Element {
  const { t } = useI18n();

  return (
    <div className="mcp-key-value-editor">
      <div className="api-settings-form-section-header">
        <strong className="api-settings-form-section-title">{title}</strong>
        <button
          className="api-settings-form-btn secondary compact"
          onClick={onAddItem}
          type="button"
          disabled={isBusy}
        >
          <Plus size={14} />
          <span>{t("settings.add", { defaultValue: "Add" })}</span>
        </button>
      </div>

      <div className="custom-headers-editor-list">
        {items.length === 0 ? (
          <div className="system-prompt-empty compact">{emptyMessage}</div>
        ) : (
          items.map((item) => (
            <div className="mcp-string-list-row" key={item.id}>
              <label className="api-settings-field">
                <span>{itemLabel}</span>
                <input
                  value={item.value}
                  onChange={(event) => onUpdateItem(item.id, event.target.value)}
                  placeholder={valuePlaceholder}
                  disabled={isBusy}
                />
              </label>
              <button
                className="icon-btn ghost custom-headers-remove-btn"
                onClick={() => onRemoveItem(item.id)}
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
