import { Download, Loader2, Plus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "../../i18n";
import { AutoDismissNotice } from "../AutoDismissNotice";
import { McpSettingsEditor } from "./mcpSettings/McpSettingsEditor";
import { McpSettingsList } from "./mcpSettings/McpSettingsList";
import { McpSettingsSummary } from "./mcpSettings/McpSettingsSummary";
import {
  EMPTY_MCP_SERVER_DRAFT,
  createMcpPair,
  createMcpStringItem,
  hasDuplicatePairKey,
  toDraft,
  toInput,
} from "./mcpSettings/mcpSettingsUtils";
import type { McpServerConfig, McpServerDraft } from "./mcpSettings/types";

type McpSettingsPanelProps = {
  onClose?: () => void;
};

export function McpSettingsPanel({
  onClose,
}: McpSettingsPanelProps): React.JSX.Element {
  const { t } = useI18n();
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [draft, setDraft] = useState<McpServerDraft | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const isBusy = isLoading || isSaving;

  const load = useCallback(async () => {
    setIsLoading(true);
    setError("");

    try {
      const items = await window.snow.listMcpServerConfigs();
      setServers(items);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : t("settings.mcpLoadError", {
              defaultValue: "Failed to load MCP servers",
            })
      );
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleImport = async () => {
    setIsLoading(true);
    setError("");
    setStatus("");

    try {
      const items = await window.snow.importSnowCliMcpConfig();
      setServers(items);
      setDraft(null);
      setStatus(
        t("settings.mcpImportSuccess", {
          defaultValue: "Synced MCP servers from Snow CLI.",
        })
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : t("settings.mcpImportError", {
              defaultValue: "Failed to sync Snow CLI MCP settings",
            })
      );
    } finally {
      setIsLoading(false);
    }
  };

  const startAdd = () => {
    const maxSortOrder = servers.reduce(
      (max, server) => Math.max(max, server.sortOrder),
      -1
    );
    setDraft({
      ...EMPTY_MCP_SERVER_DRAFT,
      sortOrder: maxSortOrder + 1,
    });
    setError("");
    setStatus("");
  };

  const startEdit = (server: McpServerConfig) => {
    setDraft(toDraft(server));
    setError("");
    setStatus("");
  };

  const cancelDraft = () => {
    setDraft(null);
    setError("");
  };

  const patchDraft = (patch: Partial<McpServerDraft>) => {
    setDraft((previous) => (previous ? { ...previous, ...patch } : null));
  };

  const updatePair = (
    group: "env" | "headers",
    pairId: string,
    field: "key" | "value",
    value: string
  ) => {
    setDraft((previous) =>
      previous
        ? {
            ...previous,
            [group]: previous[group].map((pair) =>
              pair.id === pairId ? { ...pair, [field]: value } : pair
            ),
          }
        : null
    );
  };

  const addPair = (group: "env" | "headers") => {
    setDraft((previous) =>
      previous
        ? { ...previous, [group]: [...previous[group], createMcpPair()] }
        : null
    );
  };

  const removePair = (group: "env" | "headers", pairId: string) => {
    setDraft((previous) =>
      previous
        ? {
            ...previous,
            [group]: previous[group].filter((pair) => pair.id !== pairId),
          }
        : null
    );
  };

  const updateArg = (argId: string, value: string) => {
    setDraft((previous) =>
      previous
        ? {
            ...previous,
            args: previous.args.map((arg) =>
              arg.id === argId ? { ...arg, value } : arg
            ),
          }
        : null
    );
  };

  const addArg = () => {
    setDraft((previous) =>
      previous
        ? { ...previous, args: [...previous.args, createMcpStringItem()] }
        : null
    );
  };

  const removeArg = (argId: string) => {
    setDraft((previous) =>
      previous
        ? { ...previous, args: previous.args.filter((arg) => arg.id !== argId) }
        : null
    );
  };

  const saveDraft = async () => {
    if (!draft) return;

    if (!draft.name.trim()) {
      setError(
        t("settings.mcpNameRequired", {
          defaultValue: "MCP server name is required.",
        })
      );
      setStatus("");
      return;
    }

    if (draft.transportType === "http" && !draft.url.trim()) {
      setError(
        t("settings.mcpUrlRequired", { defaultValue: "URL is required." })
      );
      setStatus("");
      return;
    }

    if (draft.transportType === "stdio" && !draft.command.trim()) {
      setError(
        t("settings.mcpCommandRequired", {
          defaultValue: "Command is required.",
        })
      );
      setStatus("");
      return;
    }

    if (hasDuplicatePairKey(draft.env) || hasDuplicatePairKey(draft.headers)) {
      setError(
        t("settings.mcpDuplicateKey", {
          defaultValue: "Environment and header names must be unique.",
        })
      );
      setStatus("");
      return;
    }

    const timeoutMs = draft.timeoutMs.trim() ? Number(draft.timeoutMs) : null;
    if (
      timeoutMs !== null &&
      (!Number.isInteger(timeoutMs) || timeoutMs <= 0)
    ) {
      setError(
        t("settings.mcpTimeoutInvalid", {
          defaultValue: "Timeout must be a positive integer.",
        })
      );
      setStatus("");
      return;
    }

    setIsSaving(true);
    setError("");
    setStatus("");

    try {
      const maxSortOrder = servers.reduce(
        (max, server) => Math.max(max, server.sortOrder),
        -1
      );
      const items = await window.snow.upsertMcpServerConfig(
        toInput(draft, maxSortOrder + 1)
      );

      setServers(items);
      setDraft(null);
      setStatus(
        draft.serverId
          ? t("settings.mcpSaveSuccess", {
              defaultValue: "Saved MCP server.",
            })
          : t("settings.mcpAddSuccess", {
              defaultValue: "Added MCP server.",
            })
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : t("settings.mcpSaveError", {
              defaultValue: "Failed to save MCP server",
            })
      );
    } finally {
      setIsSaving(false);
    }
  };

  const toggleEnabled = async (server: McpServerConfig) => {
    setError("");
    setStatus("");

    try {
      const items = await window.snow.upsertMcpServerConfig({
        serverId: server.serverId,
        scope: server.scope,
        name: server.name,
        transportType: server.transportType,
        url: server.url,
        command: server.command,
        argsJson: server.argsJson,
        envJson: server.envJson,
        headersJson: server.headersJson,
        enabled: !server.enabled,
        ...(server.timeoutMs ? { timeoutMs: server.timeoutMs } : {}),
        sortOrder: server.sortOrder,
        source: server.source,
      });
      setServers(items);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : t("settings.mcpSaveError", {
              defaultValue: "Failed to update MCP server",
            })
      );
    }
  };

  const handleDelete = async (server: McpServerConfig) => {
    setError("");
    setStatus("");

    try {
      const items = await window.snow.deleteMcpServerConfig(server.serverId);
      setServers(items);
      setStatus(
        t("settings.mcpDeleteSuccess", {
          defaultValue: "Deleted MCP server.",
        })
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : t("settings.mcpDeleteError", {
              defaultValue: "Failed to delete MCP server",
            })
      );
    }
  };

  return (
    <div className="api-settings-page" role="region">
      <div className="api-settings-page-header">
        <div className="api-settings-title-group">
          <span className="api-settings-kicker">
            {t("settings.mcpKicker", { defaultValue: "Snow CLI compatible" })}
          </span>
          <strong>
            {t("settings.mcpTitle", { defaultValue: "MCP settings" })}
          </strong>
        </div>
        {onClose && (
          <button
            className="icon-btn ghost"
            onClick={onClose}
            type="button"
            aria-label={t("settings.closeMcpSettings", {
              defaultValue: "Close MCP settings",
            })}
            title={t("settings.closeMcpSettings", {
              defaultValue: "Close MCP settings",
            })}
          >
            <X size={15} strokeWidth={1.8} />
          </button>
        )}
      </div>

      <McpSettingsSummary servers={servers} />

      <div className="api-settings-actions">
        <button
          className="api-settings-action-btn primary"
          onClick={() => void handleImport()}
          type="button"
          disabled={isBusy}
        >
          {isLoading ? (
            <Loader2 size={15} className="spin" />
          ) : (
            <Download size={15} />
          )}
          <span>
            {t("settings.syncSnowCliMcp", {
              defaultValue: "Sync Snow CLI MCP settings",
            })}
          </span>
        </button>
        <button
          className="api-settings-action-btn secondary"
          onClick={startAdd}
          type="button"
          disabled={isBusy}
        >
          <Plus size={15} />
          <span>{t("settings.mcpAddNew", { defaultValue: "Add server" })}</span>
        </button>
      </div>

      <AutoDismissNotice
        message={error || status}
        tone={error ? "error" : "success"}
        onDismiss={() => {
          setError("");
          setStatus("");
        }}
      />

      <div className="api-settings-manual-form">
        <div className="api-settings-manual-header">
          <strong>
            {t("settings.mcpManualTitle", {
              defaultValue: "Manage MCP servers",
            })}
          </strong>
          <span>
            {t("settings.mcpManualInfo", {
              defaultValue:
                "These servers are saved in the local app database and can be synced from Snow CLI settings.json files.",
            })}
          </span>
        </div>

        <div className="api-settings-form-body">
          {draft && (
            <McpSettingsEditor
              draft={draft}
              isBusy={isBusy}
              isSaving={isSaving}
              onDraftChange={patchDraft}
              onUpdatePair={updatePair}
              onAddPair={addPair}
              onRemovePair={removePair}
              onUpdateArg={updateArg}
              onAddArg={addArg}
              onRemoveArg={removeArg}
              onCancel={cancelDraft}
              onSave={() => void saveDraft()}
            />
          )}

          <McpSettingsList
            servers={servers}
            isBusy={isBusy}
            onToggleEnabled={(server) => void toggleEnabled(server)}
            onEdit={startEdit}
            onDelete={(server) => void handleDelete(server)}
          />
        </div>
      </div>
    </div>
  );
}
