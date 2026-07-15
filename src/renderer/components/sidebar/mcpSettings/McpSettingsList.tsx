import { Loader2, Pencil, Trash2, Wrench } from "lucide-react";
import { useI18n } from "../../../i18n";
import { getMcpServerEndpoint } from "./mcpSettingsUtils";
import type { McpServerConfig, McpServerTool } from "./types";

type McpSettingsListProps = {
  servers: McpServerConfig[];
  isBusy: boolean;
  toolsByServerId: Readonly<Record<string, readonly McpServerTool[]>>;
  fetchingToolServerIds: ReadonlySet<string>;
  onToggleEnabled: (server: McpServerConfig) => void;
  onFetchTools: (server: McpServerConfig) => void;
  onEdit: (server: McpServerConfig) => void;
  onDelete: (server: McpServerConfig) => void;
};

export function McpSettingsList({
  servers,
  isBusy,
  toolsByServerId,
  fetchingToolServerIds,
  onToggleEnabled,
  onFetchTools,
  onEdit,
  onDelete,
}: McpSettingsListProps): React.JSX.Element {
  const { t } = useI18n();

  return (
    <div className="api-settings-form-section">
      <div className="api-settings-form-section-header">
        <strong className="api-settings-form-section-title">
          {t("settings.mcpServerListTitle", { defaultValue: "MCP servers" })}
        </strong>
      </div>

      <div className="system-prompt-list mcp-server-list">
        {servers.length === 0 ? (
          <div className="system-prompt-empty">
            {t("settings.mcpNoServers", {
              defaultValue:
                "No MCP servers yet. Sync from Snow CLI settings.json or add one manually.",
            })}
          </div>
        ) : (
          servers.map((server) => {
            const activeLabel = server.enabled
              ? t("settings.mcpDisableServer", { defaultValue: "Disable" })
              : t("settings.mcpEnableServer", { defaultValue: "Enable" });
            const activeStateLabel = server.enabled
              ? t("settings.active", { defaultValue: "Active" })
              : t("settings.inactive", { defaultValue: "Inactive" });
            const isFetchingTools = fetchingToolServerIds.has(server.serverId);
            const tools = toolsByServerId[server.serverId];
            const toolCount = tools?.length;
            const fetchToolsLabel = server.enabled
              ? t("settings.mcpFetchTools", { defaultValue: "Fetch tools" })
              : t("settings.mcpEnableBeforeFetchTools", {
                  defaultValue: "Enable this server before fetching tools",
                });

            return (
              <div
                key={server.serverId}
                className={`system-prompt-item ${
                  server.enabled ? "active" : ""
                }`}
              >
                <div className="system-prompt-item-main">
                  <label
                    className="toggle-switch system-prompt-switch"
                    aria-label={activeLabel}
                    title={activeLabel}
                  >
                    <input
                      type="checkbox"
                      checked={server.enabled}
                      onChange={() => onToggleEnabled(server)}
                      disabled={isBusy}
                      hidden
                    />
                    <span className="toggle-slider" />
                    <span>{activeStateLabel}</span>
                  </label>
                  <div className="system-prompt-item-info">
                    <strong>{server.name}</strong>
                    <span>
                      {server.transportType} ·{" "}
                      {getMcpServerEndpoint(server) || "-"}
                    </span>
                  </div>
                </div>
                <div className="system-prompt-item-actions">
                  <button
                    className="mcp-tools-count-button"
                    onClick={() => onFetchTools(server)}
                    type="button"
                    aria-label={fetchToolsLabel}
                    title={fetchToolsLabel}
                    disabled={isBusy || isFetchingTools || !server.enabled}
                  >
                    {isFetchingTools ? (
                      <Loader2 size={13} className="spin" />
                    ) : (
                      <Wrench size={13} strokeWidth={1.9} />
                    )}
                    <span>{toolCount ?? "-"}</span>
                  </button>
                  <button
                    className="icon-btn ghost"
                    onClick={() => onEdit(server)}
                    type="button"
                    aria-label={t("settings.edit", { defaultValue: "Edit" })}
                    title={t("settings.edit", { defaultValue: "Edit" })}
                    disabled={isBusy}
                  >
                    <Pencil size={14} strokeWidth={1.9} />
                  </button>
                  <button
                    className="icon-btn ghost danger"
                    onClick={() => onDelete(server)}
                    type="button"
                    aria-label={t("settings.delete", {
                      defaultValue: "Delete",
                    })}
                    title={t("settings.delete", { defaultValue: "Delete" })}
                    disabled={isBusy}
                  >
                    <Trash2 size={14} strokeWidth={1.9} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
