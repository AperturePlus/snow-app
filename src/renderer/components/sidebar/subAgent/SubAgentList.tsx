import { LockKeyhole, Pencil, Trash2 } from "lucide-react";
import { useI18n } from "../../../i18n";
import { countTools, itemUsesAllTools } from "./subAgentUtils";
import type { SubAgentItem } from "./types";

type SubAgentListProps = {
  agents: SubAgentItem[];
  isBusy: boolean;
  onEdit: (agent: SubAgentItem) => void;
  onDelete: (agent: SubAgentItem) => void;
};

export function SubAgentList({
  agents,
  isBusy,
  onEdit,
  onDelete,
}: SubAgentListProps): React.JSX.Element {
  const { t } = useI18n();

  return (
    <div className="api-settings-form-section">
      <div className="api-settings-form-section-header">
        <strong className="api-settings-form-section-title">
          {t("settings.subAgentListTitle", { defaultValue: "Sub-agent list" })}
        </strong>
      </div>
      <div className="system-prompt-list sub-agent-list">
        {agents.length === 0 ? (
          <div className="system-prompt-empty">
            {t("settings.subAgentEmpty", {
              defaultValue: "No sub-agent configurations are available.",
            })}
          </div>
        ) : (
          agents.map((agent) => (
            <div
              className="system-prompt-item sub-agent-item"
              key={agent.agentId}
            >
              <div className="system-prompt-item-main">
                <div className="system-prompt-item-info">
                  <div className="sub-agent-item-title-row">
                    <strong>{agent.name}</strong>
                    {agent.builtin && (
                      <span className="sub-agent-builtin-badge">
                        <LockKeyhole size={11} strokeWidth={1.9} />
                        {t("settings.subAgentBuiltin", {
                          defaultValue: "Built-in",
                        })}
                      </span>
                    )}
                  </div>
                  <span>{agent.description || agent.agentId}</span>
                  <small>
                    {itemUsesAllTools(agent)
                      ? t("settings.subAgentAllTools", {
                          defaultValue: "All enabled project tools",
                        })
                      : t("settings.subAgentToolsConfigured", {
                          defaultValue: "{{count}} tools",
                          values: { count: countTools(agent) },
                        })}
                  </small>
                </div>
              </div>
              <div className="system-prompt-item-actions">
                <button
                  className="icon-btn ghost"
                  onClick={() => onEdit(agent)}
                  type="button"
                  aria-label={t("settings.edit", { defaultValue: "Edit" })}
                  title={t("settings.edit", { defaultValue: "Edit" })}
                  disabled={isBusy}
                >
                  <Pencil size={14} strokeWidth={1.9} />
                </button>
                {!agent.builtin && (
                  <button
                    className="icon-btn ghost danger"
                    onClick={() => onDelete(agent)}
                    type="button"
                    aria-label={t("settings.delete", {
                      defaultValue: "Delete",
                    })}
                    title={t("settings.delete", { defaultValue: "Delete" })}
                    disabled={isBusy}
                  >
                    <Trash2 size={14} strokeWidth={1.9} />
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
