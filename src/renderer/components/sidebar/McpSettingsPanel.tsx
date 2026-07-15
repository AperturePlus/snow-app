import {
  Download,
  Folder,
  Globe2,
  Loader2,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  McpProjectServerStatus,
  WorkspaceDirectoryRecord,
} from "../../../preload";
import { useI18n } from "../../i18n";
import { AutoDismissNotice } from "../AutoDismissNotice";
import { Modal } from "../common/Modal";
import { McpSettingsEditor } from "./mcpSettings/McpSettingsEditor";
import {
  McpSettingsList,
  type McpSettingsListItem,
} from "./mcpSettings/McpSettingsList";
import { McpSettingsSummary } from "./mcpSettings/McpSettingsSummary";
import {
  EMPTY_MCP_SERVER_DRAFT,
  createMcpPair,
  createMcpStringItem,
  getMcpServerEndpoint,
  hasDuplicatePairKey,
  toDraft,
  toInput,
} from "./mcpSettings/mcpSettingsUtils";
import type {
  McpServerConfig,
  McpServerDraft,
  McpServerTool,
} from "./mcpSettings/types";

type McpSettingsPanelProps = {
  activeDirectory?: WorkspaceDirectoryRecord | null;
  onClose?: () => void;
};

type McpScope = "global" | "project";

export function McpSettingsPanel({
  activeDirectory,
  onClose,
}: McpSettingsPanelProps): React.JSX.Element {
  const { t } = useI18n();
  const [activeScope, setActiveScope] = useState<McpScope>("global");
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [projectServers, setProjectServers] = useState<
    McpProjectServerStatus[]
  >([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [draft, setDraft] = useState<McpServerDraft | null>(null);
  const [toolsByServerId, setToolsByServerId] = useState<
    Record<string, McpServerTool[]>
  >({});
  const [fetchingToolServerIds, setFetchingToolServerIds] = useState<
    Set<string>
  >(() => new Set());
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const loadGenerationRef = useRef(0);

  const isBusy = isLoading || isSaving;

  const load = useCallback(async (): Promise<void> => {
    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;
    setIsLoading(true);
    setError("");

    try {
      const [globalItems, projectItems] = await Promise.all([
        window.snow.listMcpServerConfigs(),
        activeDirectory
          ? window.snow.listMcpProjectServers(activeDirectory.directoryId)
          : Promise.resolve([]),
      ]);
      if (loadGenerationRef.current !== generation) {
        return;
      }

      setServers(globalItems);
      setProjectServers(projectItems);
      setToolsByServerId((previous) => {
        const next = { ...previous };
        projectItems.forEach((server) => {
          if (server.tools.length > 0) {
            next[server.id] = server.tools;
          }
        });
        return next;
      });
    } catch (loadError) {
      if (loadGenerationRef.current === generation) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : t("settings.mcpLoadError", {
                defaultValue: "Failed to load MCP servers",
              })
        );
      }
    } finally {
      if (loadGenerationRef.current === generation) {
        setIsLoading(false);
      }
    }
  }, [activeDirectory, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!activeDirectory && activeScope === "project") {
      setActiveScope("global");
    }
  }, [activeDirectory, activeScope]);

  const handleImport = async () => {
    setIsLoading(true);
    setError("");
    setStatus("");

    try {
      await window.snow.importSnowCliMcpConfig();
      await load();
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

  const handleFetchTools = async (server: McpServerConfig) => {
    setFetchingToolServerIds((previous) => {
      const next = new Set(previous);
      next.add(server.serverId);
      return next;
    });
    setError("");
    setStatus("");

    try {
      const tools = await window.snow.listMcpServerTools(server.serverId);
      setToolsByServerId((previous) => ({
        ...previous,
        [server.serverId]: tools,
      }));
      setStatus(
        t("settings.mcpFetchToolsSuccess", {
          defaultValue: "Fetched {{count}} tool(s) from {{name}}.",
          values: { count: tools.length, name: server.name },
        })
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : t("settings.mcpFetchToolsError", {
              defaultValue: "Failed to fetch MCP tools",
            })
      );
    } finally {
      setFetchingToolServerIds((previous) => {
        const next = new Set(previous);
        next.delete(server.serverId);
        return next;
      });
    }
  };

  const handleDelete = async (server: McpServerConfig) => {
    setError("");
    setStatus("");

    try {
      const items = await window.snow.deleteMcpServerConfig(server.serverId);
      setServers(items);
      setToolsByServerId((previous) => {
        const next = { ...previous };
        delete next[server.serverId];
        return next;
      });
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

  const globalListItems: McpSettingsListItem[] = servers.map((server) => ({
    serverId: server.serverId,
    name: server.name,
    enabled: server.enabled,
    globalEnabled: true,
    detail: `${server.transportType} · ${getMcpServerEndpoint(server) || "-"}`,
    canManage: true,
  }));
  const projectListItems: McpSettingsListItem[] = projectServers.map(
    (server) => ({
      serverId: server.id,
      name: server.name,
      enabled: server.enabled,
      globalEnabled: server.globalEnabled,
      detail:
        server.source === "system"
          ? t("settings.mcpProjectSystemServer", {
              defaultValue: "Built-in system MCP server",
            })
          : t("settings.mcpProjectExternalServer", {
              defaultValue: "Global external MCP server",
            }),
      canManage: false,
    })
  );
  const isGlobalScope = activeScope === "global";
  const activeServers = isGlobalScope ? globalListItems : projectListItems;
  const enabledCount = activeServers.filter(
    (server) => server.enabled && server.globalEnabled
  ).length;
  const listTitle = isGlobalScope
    ? t("settings.mcpGlobalListTitle", { defaultValue: "Global MCP servers" })
    : t("settings.mcpProjectListTitle", {
        defaultValue: "Project MCP servers",
      });
  const emptyMessage = isGlobalScope
    ? t("settings.mcpNoServers", {
        defaultValue:
          "No MCP servers yet. Sync from Snow CLI settings.json or add one manually.",
      })
    : t("settings.mcpProjectNoServers", {
        defaultValue: "No MCP servers are available for this project.",
      });

  const handleProjectToggle = async (
    server: McpSettingsListItem
  ): Promise<void> => {
    if (!activeDirectory || !server.globalEnabled) {
      return;
    }

    setError("");
    setStatus("");
    try {
      await window.snow.setMcpProjectServerEnabled(
        activeDirectory.directoryId,
        server.serverId,
        !server.enabled
      );
      await load();
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : t("settings.mcpSaveError", {
              defaultValue: "Failed to update MCP server",
            })
      );
    }
  };

  const handleProjectFetchTools = async (
    server: McpSettingsListItem
  ): Promise<void> => {
    if (!activeDirectory) {
      return;
    }

    setFetchingToolServerIds((previous) =>
      new Set(previous).add(server.serverId)
    );
    setError("");
    setStatus("");
    try {
      const tools = await window.snow.listMcpProjectServerTools(
        activeDirectory.directoryId,
        server.serverId
      );
      setToolsByServerId((previous) => ({
        ...previous,
        [server.serverId]: tools,
      }));
      setStatus(
        t("settings.mcpFetchToolsSuccess", {
          defaultValue: "Fetched {{count}} tool(s) from {{name}}.",
          values: { count: tools.length, name: server.name },
        })
      );
    } catch (fetchError) {
      setError(
        fetchError instanceof Error
          ? fetchError.message
          : t("settings.mcpFetchToolsError", {
              defaultValue: "Failed to fetch MCP tools",
            })
      );
    } finally {
      setFetchingToolServerIds((previous) => {
        const next = new Set(previous);
        next.delete(server.serverId);
        return next;
      });
    }
  };

  const findGlobalServer = (serverId: string): McpServerConfig | undefined =>
    servers.find((server) => server.serverId === serverId);

  const handleListToggle = (server: McpSettingsListItem): void => {
    if (isGlobalScope) {
      const globalServer = findGlobalServer(server.serverId);
      if (globalServer) {
        void toggleEnabled(globalServer);
      }
      return;
    }
    void handleProjectToggle(server);
  };

  const handleListFetchTools = (server: McpSettingsListItem): void => {
    if (isGlobalScope) {
      const globalServer = findGlobalServer(server.serverId);
      if (globalServer) {
        void handleFetchTools(globalServer);
      }
      return;
    }
    void handleProjectFetchTools(server);
  };

  const handleListEdit = (server: McpSettingsListItem): void => {
    const globalServer = findGlobalServer(server.serverId);
    if (globalServer) {
      startEdit(globalServer);
    }
  };

  const handleListDelete = (server: McpSettingsListItem): void => {
    const globalServer = findGlobalServer(server.serverId);
    if (globalServer) {
      void handleDelete(globalServer);
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

      <McpSettingsSummary
        totalCount={activeServers.length}
        enabledCount={enabledCount}
      />

      <div className="api-settings-actions">
        {isGlobalScope ? (
          <>
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
              <span>
                {t("settings.mcpAddNew", { defaultValue: "Add server" })}
              </span>
            </button>
          </>
        ) : (
          <button
            className="api-settings-action-btn secondary"
            onClick={() => void load()}
            type="button"
            disabled={isBusy || fetchingToolServerIds.size > 0}
          >
            <RefreshCw size={15} className={isLoading ? "spin" : ""} />
            <span>
              {t("settings.mcpProjectRefresh", {
                defaultValue: "Refresh project MCP",
              })}
            </span>
          </button>
        )}
      </div>

      <AutoDismissNotice
        message={error || status}
        tone={error ? "error" : "success"}
        onDismiss={() => {
          setError("");
          setStatus("");
        }}
      />

      <div
        className="skills-settings-tabs"
        role="tablist"
        aria-label={t("settings.mcpScopeTabs", {
          defaultValue: "MCP scope",
        })}
      >
        <button
          className={`skills-settings-tab ${isGlobalScope ? "active" : ""}`}
          type="button"
          role="tab"
          aria-selected={isGlobalScope}
          onClick={() => setActiveScope("global")}
        >
          <Globe2 size={14} strokeWidth={1.8} />
          <span>{t("settings.mcpTabGlobal", { defaultValue: "Global" })}</span>
          <small>{globalListItems.length}</small>
        </button>
        <button
          className={`skills-settings-tab ${!isGlobalScope ? "active" : ""}`}
          type="button"
          role="tab"
          aria-selected={!isGlobalScope}
          onClick={() => setActiveScope("project")}
          disabled={!activeDirectory}
        >
          <Folder size={14} strokeWidth={1.8} />
          <span>
            {t("settings.mcpTabProject", { defaultValue: "Project" })}
          </span>
          <small>{projectListItems.length}</small>
        </button>
      </div>

      <div className="api-settings-manual-form">
        <div className="api-settings-manual-header">
          <strong>{listTitle}</strong>
          <span>
            {isGlobalScope
              ? t("settings.mcpGlobalTabInfo", {
                  defaultValue:
                    "Manage external MCP servers shared by all projects.",
                })
              : t("settings.mcpProjectTabInfo", {
                  defaultValue:
                    "Enable or disable built-in and global external MCP servers for {{name}}.",
                  values: { name: activeDirectory?.name ?? "" },
                })}
          </span>
        </div>

        <div className="api-settings-form-body">
          <McpSettingsList
            servers={activeServers}
            isBusy={isBusy}
            listTitle={listTitle}
            emptyMessage={emptyMessage}
            toolsByServerId={toolsByServerId}
            fetchingToolServerIds={fetchingToolServerIds}
            onToggleEnabled={handleListToggle}
            onFetchTools={handleListFetchTools}
            onEdit={handleListEdit}
            onDelete={handleListDelete}
          />
        </div>
      </div>

      <Modal
        open={Boolean(draft)}
        title={t("settings.mcpEditorTitle", {
          defaultValue: "MCP server editor",
        })}
        description={
          draft?.name || t("settings.mcpAddNew", { defaultValue: "Add server" })
        }
        closeLabel={t("settings.cancel", { defaultValue: "Cancel" })}
        onClose={cancelDraft}
        closeDisabled={isBusy}
        size="large"
        className="mcp-settings-editor-modal"
      >
        {draft && (
          <McpSettingsEditor
            draft={draft}
            isBusy={isBusy}
            isSaving={isSaving}
            tools={draft.serverId ? toolsByServerId[draft.serverId] : undefined}
            isFetchingTools={
              Boolean(draft.serverId) &&
              fetchingToolServerIds.has(draft.serverId)
            }
            onFetchTools={() => {
              const server = servers.find(
                (item) => item.serverId === draft.serverId
              );
              if (server) {
                void handleFetchTools(server);
              }
            }}
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
      </Modal>
    </div>
  );
}
