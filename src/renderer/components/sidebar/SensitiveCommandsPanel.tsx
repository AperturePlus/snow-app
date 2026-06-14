import { Download, Loader2, Plus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "../../i18n";
import { AutoDismissNotice } from "../AutoDismissNotice";
import { SensitiveCommandEditor } from "./sensitiveCommands/SensitiveCommandEditor";
import { SensitiveCommandList } from "./sensitiveCommands/SensitiveCommandList";
import { SensitiveCommandSummary } from "./sensitiveCommands/SensitiveCommandSummary";
import {
  EMPTY_SENSITIVE_COMMAND_DRAFT,
  hasDuplicatePattern,
  toDraft,
  toInput,
} from "./sensitiveCommands/sensitiveCommandUtils";
import type {
  SensitiveCommandConfig,
  SensitiveCommandDraft,
} from "./sensitiveCommands/types";

type SensitiveCommandsPanelProps = {
  onClose?: () => void;
};

export function SensitiveCommandsPanel({
  onClose,
}: SensitiveCommandsPanelProps): React.JSX.Element {
  const { t } = useI18n();
  const [commands, setCommands] = useState<SensitiveCommandConfig[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [draft, setDraft] = useState<SensitiveCommandDraft | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const isBusy = isLoading || isSaving;

  const load = useCallback(async () => {
    setIsLoading(true);
    setError("");

    try {
      const items = await window.snow.listSensitiveCommandConfigs();
      setCommands(items);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : t("settings.sensitiveCommandLoadError", {
              defaultValue: "Failed to load sensitive command rules",
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
      const items = await window.snow.importSnowCliSensitiveCommandConfig();
      setCommands(items);
      setDraft(null);
      setStatus(
        t("settings.sensitiveCommandImportSuccess", {
          defaultValue: "Synced sensitive command rules from Snow CLI.",
        })
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : t("settings.sensitiveCommandImportError", {
              defaultValue: "Failed to sync Snow CLI sensitive command rules",
            })
      );
    } finally {
      setIsLoading(false);
    }
  };

  const startAdd = () => {
    const maxSortOrder = commands.reduce(
      (max, command) => Math.max(max, command.sortOrder),
      -1
    );
    setDraft({
      ...EMPTY_SENSITIVE_COMMAND_DRAFT,
      sortOrder: maxSortOrder + 1,
    });
    setError("");
    setStatus("");
  };

  const startEdit = (command: SensitiveCommandConfig) => {
    setDraft(toDraft(command));
    setError("");
    setStatus("");
  };

  const cancelDraft = () => {
    setDraft(null);
    setError("");
  };

  const patchDraft = (patch: Partial<SensitiveCommandDraft>) => {
    setDraft((previous) => (previous ? { ...previous, ...patch } : null));
  };

  const saveDraft = async () => {
    if (!draft) return;

    if (!draft.pattern.trim()) {
      setError(
        t("settings.sensitiveCommandPatternRequired", {
          defaultValue: "Command pattern is required.",
        })
      );
      setStatus("");
      return;
    }

    if (hasDuplicatePattern(commands, draft)) {
      setError(
        t("settings.sensitiveCommandDuplicatePattern", {
          defaultValue: "Command pattern already exists.",
        })
      );
      setStatus("");
      return;
    }

    setIsSaving(true);
    setError("");
    setStatus("");

    try {
      const maxSortOrder = commands.reduce(
        (max, command) => Math.max(max, command.sortOrder),
        -1
      );
      const items = await window.snow.upsertSensitiveCommandConfig(
        toInput(draft, maxSortOrder + 1)
      );

      setCommands(items);
      setDraft(null);
      setStatus(
        draft.commandId
          ? t("settings.sensitiveCommandSaveSuccess", {
              defaultValue: "Saved sensitive command rule.",
            })
          : t("settings.sensitiveCommandAddSuccess", {
              defaultValue: "Added sensitive command rule.",
            })
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : t("settings.sensitiveCommandSaveError", {
              defaultValue: "Failed to save sensitive command rule",
            })
      );
    } finally {
      setIsSaving(false);
    }
  };

  const toggleEnabled = async (command: SensitiveCommandConfig) => {
    setError("");
    setStatus("");

    try {
      const items = await window.snow.upsertSensitiveCommandConfig({
        commandId: command.commandId,
        scope: command.scope,
        pattern: command.pattern,
        description: command.description,
        enabled: !command.enabled,
        isPreset: command.isPreset,
        sortOrder: command.sortOrder,
        source: command.source,
      });
      setCommands(items);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : t("settings.sensitiveCommandSaveError", {
              defaultValue: "Failed to update sensitive command rule",
            })
      );
    }
  };

  const handleDelete = async (command: SensitiveCommandConfig) => {
    setError("");
    setStatus("");

    if (command.isPreset) {
      setError(
        t("settings.sensitiveCommandPresetDeleteBlocked", {
          defaultValue: "Preset rules cannot be deleted.",
        })
      );
      return;
    }

    try {
      const items = await window.snow.deleteSensitiveCommandConfig(
        command.commandId,
        command.scope
      );
      setCommands(items);
      setStatus(
        t("settings.sensitiveCommandDeleteSuccess", {
          defaultValue: "Deleted sensitive command rule.",
        })
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : t("settings.sensitiveCommandDeleteError", {
              defaultValue: "Failed to delete sensitive command rule",
            })
      );
    }
  };

  return (
    <div className="api-settings-page" role="region">
      <div className="api-settings-page-header">
        <div className="api-settings-title-group">
          <span className="api-settings-kicker">
            {t("settings.sensitiveCommandKicker", {
              defaultValue: "Snow CLI compatible",
            })}
          </span>
          <strong>
            {t("settings.sensitiveCommandTitle", {
              defaultValue: "Sensitive commands",
            })}
          </strong>
        </div>
        {onClose && (
          <button
            className="icon-btn ghost"
            onClick={onClose}
            type="button"
            aria-label={t("settings.closeSensitiveCommandSettings", {
              defaultValue: "Close sensitive command settings",
            })}
            title={t("settings.closeSensitiveCommandSettings", {
              defaultValue: "Close sensitive command settings",
            })}
          >
            <X size={15} strokeWidth={1.8} />
          </button>
        )}
      </div>

      <SensitiveCommandSummary commands={commands} />

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
            {t("settings.syncSnowCliSensitiveCommands", {
              defaultValue: "Sync Snow CLI sensitive commands",
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
            {t("settings.sensitiveCommandAddNew", { defaultValue: "Add rule" })}
          </span>
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
            {t("settings.sensitiveCommandManualTitle", {
              defaultValue: "Manage command approval rules",
            })}
          </strong>
          <span>
            {t("settings.sensitiveCommandManualInfo", {
              defaultValue:
                "Rules are saved in the local app database. Presets are seeded from Snow CLI defaults and can be synced from settings.json.",
            })}
          </span>
        </div>

        <div className="api-settings-form-body">
          {draft && (
            <SensitiveCommandEditor
              draft={draft}
              isBusy={isBusy}
              isSaving={isSaving}
              onDraftChange={patchDraft}
              onCancel={cancelDraft}
              onSave={() => void saveDraft()}
            />
          )}

          <SensitiveCommandList
            commands={commands}
            isBusy={isBusy}
            onToggleEnabled={(command) => void toggleEnabled(command)}
            onEdit={startEdit}
            onDelete={(command) => void handleDelete(command)}
          />
        </div>
      </div>
    </div>
  );
}
