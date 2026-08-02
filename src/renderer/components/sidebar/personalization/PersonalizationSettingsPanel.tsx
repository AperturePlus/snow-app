import { Info, Layers, X } from "lucide-react";
import { useI18n } from "../../../i18n";
import { GlobalRoleEditor } from "./GlobalRoleEditor";
import { ProjectRoleEditor } from "./ProjectRoleEditor";

export type PersonalizationSettingsPanelProps = {
  onClose?: () => void;
};

/**
 * 个性化/规则设置面板：
 * - 全局规则：编辑 ~/.snow/ROLE.md（对所有项目与对话生效）
 * - 项目规则：选择项目后编辑该项目 ROLE.md（本地/SSH，覆盖全局规则）
 * - 规则优先级说明：会话指令 > 项目规则 > 全局规则 > 内置默认
 */
export function PersonalizationSettingsPanel({
  onClose,
}: PersonalizationSettingsPanelProps): React.JSX.Element {
  const { t } = useI18n();

  return (
    <div className="api-settings-page personalization-page" role="region">
      <div className="api-settings-page-header">
        <div className="api-settings-title-group">
          <strong>
            {t("settings.personalizationTitle", {
              defaultValue: "Personalization & Rules",
            })}
          </strong>
          <span className="settings-item-description">
            {t("settings.personalizationSettingsInfo", {
              defaultValue:
                "Manage global and project-level behavior rules for the AI assistant.",
            })}
          </span>
        </div>
        {onClose && (
          <button
            className="icon-btn ghost"
            onClick={onClose}
            type="button"
            aria-label={t("personalization.close", {
              defaultValue: "Close personalization settings",
            })}
            title={t("personalization.close", {
              defaultValue: "Close personalization settings",
            })}
          >
            <X size={15} strokeWidth={1.8} />
          </button>
        )}
      </div>

      <GlobalRoleEditor />
      <ProjectRoleEditor />

      <section
        className="personalization-section"
        aria-label={t("personalization.priorityTitle")}
      >
        <div className="personalization-section-header">
          <div className="personalization-section-title">
            <Layers size={15} strokeWidth={1.8} />
            <strong>
              {t("personalization.priorityTitle", {
                defaultValue: "Rule priority",
              })}
            </strong>
            <span>
              {t("personalization.priorityInfo", {
                defaultValue:
                  "Rules take effect in the following order, later ones override earlier ones:",
              })}
            </span>
          </div>
        </div>

        <ol className="personalization-priority-list">
          <li>
            <strong>
              {t("personalization.prioritySession", {
                defaultValue: "Conversation instructions",
              })}
            </strong>
            <span>
              {t("personalization.prioritySessionDesc", {
                defaultValue:
                  "Temporary instructions given in the current conversation.",
              })}
            </span>
          </li>
          <li>
            <strong>
              {t("personalization.priorityProject", {
                defaultValue: "Project rules",
              })}
            </strong>
            <span>
              {t("personalization.priorityProjectDesc", {
                defaultValue:
                  "ROLE.md at the selected project root, applied when a project is active.",
              })}
            </span>
          </li>
          <li>
            <strong>
              {t("personalization.priorityGlobal", {
                defaultValue: "Global rules",
              })}
            </strong>
            <span>
              {t("personalization.priorityGlobalDesc", {
                defaultValue:
                  "~/.snow/ROLE.md, applied to every project and conversation.",
              })}
            </span>
          </li>
          <li>
            <strong>
              {t("personalization.priorityDefault", {
                defaultValue: "Built-in default prompt",
              })}
            </strong>
            <span>
              {t("personalization.priorityDefaultDesc", {
                defaultValue:
                  "Used when no project or global rules are defined.",
              })}
            </span>
          </li>
        </ol>

        <div className="personalization-priority-note">
          <Info size={14} />
          <span>
            {t("personalization.priorityNote", {
              defaultValue:
                "Project rules override global rules; if a project has no ROLE.md, the global rules are used automatically.",
            })}
          </span>
        </div>
      </section>
    </div>
  );
}
