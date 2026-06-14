import { Loader2, Save, X } from "lucide-react";
import { useI18n } from "../../../i18n";
import { McpKeyValueEditor } from "./McpKeyValueEditor";
import { McpStringListEditor } from "./McpStringListEditor";
import type { McpServerDraft } from "./types";

type McpSettingsEditorProps = {
  draft: McpServerDraft;
  isBusy: boolean;
  isSaving: boolean;
  onDraftChange: (patch: Partial<McpServerDraft>) => void;
  onUpdatePair: (
    group: "env" | "headers",
    pairId: string,
    field: "key" | "value",
    value: string
  ) => void;
  onAddPair: (group: "env" | "headers") => void;
  onRemovePair: (group: "env" | "headers", pairId: string) => void;
  onUpdateArg: (argId: string, value: string) => void;
  onAddArg: () => void;
  onRemoveArg: (argId: string) => void;
  onCancel: () => void;
  onSave: () => void;
};

export function McpSettingsEditor({
  draft,
  isBusy,
  isSaving,
  onDraftChange,
  onUpdatePair,
  onAddPair,
  onRemovePair,
  onUpdateArg,
  onAddArg,
  onRemoveArg,
  onCancel,
  onSave,
}: McpSettingsEditorProps): React.JSX.Element {
  const { t } = useI18n();
  const isHttp = draft.transportType === "http";

  return (
    <div className="api-settings-form-section">
      <strong className="api-settings-form-section-title">
        {t("settings.mcpEditorTitle", { defaultValue: "MCP server editor" })}
      </strong>

      <div className="api-settings-form-grid">
        <label className="api-settings-field">
          <span>
            {t("settings.mcpServerName", { defaultValue: "Server name" })}
          </span>
          <input
            value={draft.name}
            onChange={(event) => onDraftChange({ name: event.target.value })}
            placeholder={t("settings.mcpServerNamePlaceholder", {
              defaultValue: "e.g. filesystem",
            })}
            disabled={isBusy}
          />
        </label>
        <label className="api-settings-field">
          <span>{t("settings.mcpScope", { defaultValue: "Scope" })}</span>
          <select
            value={draft.scope}
            onChange={(event) => onDraftChange({ scope: event.target.value })}
            disabled={isBusy}
          >
            <option value="global">
              {t("settings.mcpScopeGlobal", { defaultValue: "Global" })}
            </option>
            <option value="project">
              {t("settings.mcpScopeProject", { defaultValue: "Project" })}
            </option>
          </select>
        </label>
        <label className="api-settings-field">
          <span>
            {t("settings.mcpTransportType", { defaultValue: "Transport" })}
          </span>
          <select
            value={draft.transportType}
            onChange={(event) =>
              onDraftChange({ transportType: event.target.value })
            }
            disabled={isBusy}
          >
            <option value="stdio">stdio</option>
            <option value="http">http</option>
          </select>
        </label>
        <label className="api-settings-field">
          <span>
            {t("settings.mcpTimeoutMs", { defaultValue: "Timeout (ms)" })}
          </span>
          <input
            value={draft.timeoutMs}
            onChange={(event) =>
              onDraftChange({ timeoutMs: event.target.value })
            }
            placeholder="300000"
            disabled={isBusy}
          />
        </label>
        <label className="api-settings-field wide">
          <span>
            {isHttp
              ? t("settings.mcpUrl", { defaultValue: "URL" })
              : t("settings.mcpCommand", { defaultValue: "Command" })}
          </span>
          <input
            value={isHttp ? draft.url : draft.command}
            onChange={(event) =>
              onDraftChange(
                isHttp
                  ? { url: event.target.value }
                  : { command: event.target.value }
              )
            }
            placeholder={isHttp ? "https://example.com/mcp" : "npx"}
            disabled={isBusy}
          />
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
            {t("settings.mcpServerEnabled", { defaultValue: "Enable server" })}
          </span>
        </label>
      </div>

      {!isHttp && (
        <McpStringListEditor
          title={t("settings.mcpArgs", { defaultValue: "Args" })}
          items={draft.args}
          isBusy={isBusy}
          itemLabel={t("settings.mcpArgValue", { defaultValue: "Argument" })}
          valuePlaceholder="@modelcontextprotocol/server-filesystem"
          emptyMessage={t("settings.mcpNoArgs", {
            defaultValue: "No arguments",
          })}
          onUpdateItem={onUpdateArg}
          onAddItem={onAddArg}
          onRemoveItem={onRemoveArg}
        />
      )}

      <McpKeyValueEditor
        title={t("settings.mcpEnvironment", { defaultValue: "Environment" })}
        pairs={draft.env}
        isBusy={isBusy}
        namePlaceholder="API_KEY"
        valuePlaceholder="value"
        onUpdatePair={(pairId, field, value) =>
          onUpdatePair("env", pairId, field, value)
        }
        onAddPair={() => onAddPair("env")}
        onRemovePair={(pairId) => onRemovePair("env", pairId)}
      />

      <McpKeyValueEditor
        title={t("settings.mcpHeaders", { defaultValue: "Headers" })}
        pairs={draft.headers}
        isBusy={isBusy}
        namePlaceholder="Authorization"
        valuePlaceholder="Bearer token"
        onUpdatePair={(pairId, field, value) =>
          onUpdatePair("headers", pairId, field, value)
        }
        onAddPair={() => onAddPair("headers")}
        onRemovePair={(pairId) => onRemovePair("headers", pairId)}
      />

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
            {t("settings.saveMcpServer", { defaultValue: "Save server" })}
          </span>
        </button>
      </div>
    </div>
  );
}
