import {
  BookOpen,
  CircleCheck,
  CirclePause,
  Folder,
  Globe2,
  Loader2,
  RefreshCw,
  Wrench,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type {
  SkillDefinition,
  WorkspaceDirectoryRecord,
} from "../../../preload";
import { useI18n } from "../../i18n";
import { AutoDismissNotice } from "../AutoDismissNotice";

type SkillsSettingsPanelProps = {
  activeDirectory?: WorkspaceDirectoryRecord | null;
  onClose?: () => void;
};

type SkillsScope = "global" | "project";
type SkillsByScope = Record<SkillsScope, SkillDefinition[]>;

const EMPTY_SKILLS_BY_SCOPE: SkillsByScope = {
  global: [],
  project: [],
};

export function SkillsSettingsPanel({
  activeDirectory,
  onClose,
}: SkillsSettingsPanelProps): React.JSX.Element {
  const { t } = useI18n();
  const [activeScope, setActiveScope] = useState<SkillsScope>("global");
  const [skillsByScope, setSkillsByScope] = useState<SkillsByScope>(
    EMPTY_SKILLS_BY_SCOPE
  );
  const [isLoading, setIsLoading] = useState(false);
  const [updatingSkillId, setUpdatingSkillId] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const loadSkills = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError("");

    try {
      const [globalSkills, effectiveSkills] = await Promise.all([
        window.snow.listAvailableSkills(),
        activeDirectory
          ? window.snow.listAvailableSkills(activeDirectory.directoryId)
          : Promise.resolve([]),
      ]);
      const globalSkillIds = new Set(globalSkills.map((skill) => skill.id));
      const projectSkills = effectiveSkills.filter(
        (skill) => skill.location === "project" && !globalSkillIds.has(skill.id)
      );

      setSkillsByScope({
        global: globalSkills,
        project: projectSkills,
      });
    } catch (loadError) {
      setSkillsByScope(EMPTY_SKILLS_BY_SCOPE);
      setError(
        loadError instanceof Error
          ? loadError.message
          : t("settings.skillsLoadError", {
              defaultValue: "Failed to load Skills",
            })
      );
    } finally {
      setIsLoading(false);
    }
  }, [activeDirectory, t]);

  const toggleSkillEnabled = useCallback(
    async (skill: SkillDefinition): Promise<void> => {
      const nextEnabled = !skill.enabled;
      setUpdatingSkillId(skill.id);
      setError("");
      setStatus("");

      try {
        await window.snow.setSkillEnabled(
          skill.location === "project"
            ? activeDirectory?.directoryId
            : undefined,
          skill.id,
          nextEnabled
        );
        await loadSkills();
        setStatus(
          t(
            nextEnabled
              ? "settings.skillsEnableSuccess"
              : "settings.skillsDisableSuccess",
            {
              defaultValue: nextEnabled
                ? "Skill enabled."
                : "Skill disabled and removed from skill-execute.",
            }
          )
        );
      } catch (updateError) {
        setError(
          updateError instanceof Error
            ? updateError.message
            : t("settings.skillsUpdateError", {
                defaultValue: "Failed to update Skill",
              })
        );
      } finally {
        setUpdatingSkillId("");
      }
    },
    [activeDirectory?.directoryId, loadSkills, t]
  );

  useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

  useEffect(() => {
    if (!activeDirectory && activeScope === "project") {
      setActiveScope("global");
    }
  }, [activeDirectory, activeScope]);

  const allSkills = [...skillsByScope.global, ...skillsByScope.project];
  const enabledCount = allSkills.filter((skill) => skill.enabled).length;
  const disabledCount = allSkills.length - enabledCount;
  const activeSkills = skillsByScope[activeScope];
  const isGlobalScope = activeScope === "global";
  const scopeTitle = isGlobalScope
    ? t("settings.skillsGlobalListTitle", { defaultValue: "Global Skills" })
    : t("settings.skillsProjectListTitle", { defaultValue: "Project Skills" });
  const scopeDescription = isGlobalScope
    ? t("settings.skillsGlobalTabInfo", {
        defaultValue:
          "Skills from the user profile. IDs that also exist in the project are listed here only.",
      })
    : t("settings.skillsProjectTabInfo", {
        defaultValue:
          "Project-only Skills for {{name}}. IDs already present globally are excluded.",
        values: { name: activeDirectory?.name ?? "" },
      });

  return (
    <div className="api-settings-page skills-settings-page" role="region">
      <div className="api-settings-page-header">
        <div className="api-settings-title-group">
          <strong>
            {t("settings.skillsTitle", { defaultValue: "Skills settings" })}
          </strong>
          <span className="settings-item-description">
            {t("settings.skillsSettingsInfo", {
              defaultValue: "View effective project and global Skills.",
            })}
          </span>
        </div>
        {onClose && (
          <button
            className="icon-btn ghost"
            onClick={onClose}
            type="button"
            aria-label={t("settings.closeSkillsSettings", {
              defaultValue: "Close Skills settings",
            })}
            title={t("settings.closeSkillsSettings", {
              defaultValue: "Close Skills settings",
            })}
          >
            <X size={15} strokeWidth={1.8} />
          </button>
        )}
      </div>

      <div className="api-settings-summary-grid skills-settings-summary-grid">
        <div className="api-settings-summary-card">
          <BookOpen size={15} strokeWidth={1.8} />
          <span>{allSkills.length}</span>
          <small>
            {t("settings.skillsAvailableCount", { defaultValue: "Skills" })}
          </small>
        </div>
        <div className="api-settings-summary-card">
          <CircleCheck size={15} strokeWidth={1.8} />
          <span>{enabledCount}</span>
          <small>
            {t("settings.skillsEnabledCount", { defaultValue: "Enabled" })}
          </small>
        </div>
        <div className="api-settings-summary-card">
          <CirclePause size={15} strokeWidth={1.8} />
          <span>{disabledCount}</span>
          <small>
            {t("settings.skillsDisabledCount", { defaultValue: "Disabled" })}
          </small>
        </div>
      </div>

      <div className="api-settings-actions skills-settings-actions">
        <button
          className="api-settings-action-btn secondary"
          onClick={() => void loadSkills()}
          type="button"
          disabled={isLoading || Boolean(updatingSkillId)}
          aria-label={t("settings.skillsRefresh", {
            defaultValue: "Refresh Skills",
          })}
          title={t("settings.skillsRefresh", {
            defaultValue: "Refresh Skills",
          })}
        >
          <RefreshCw size={15} className={isLoading ? "spin" : ""} />
          <span>
            {t(
              isLoading
                ? "settings.skillsRefreshing"
                : "settings.skillsRefresh",
              { defaultValue: isLoading ? "Refreshing..." : "Refresh Skills" }
            )}
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

      <div
        className="skills-settings-tabs"
        role="tablist"
        aria-label={t("settings.skillsScopeTabs", {
          defaultValue: "Skills scope",
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
          <span>
            {t("settings.skillsTabGlobal", { defaultValue: "Global" })}
          </span>
          <small>{skillsByScope.global.length}</small>
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
            {t("settings.skillsTabProject", { defaultValue: "Project" })}
          </span>
          <small>{skillsByScope.project.length}</small>
        </button>
      </div>

      <section className="api-settings-form-section skills-settings-section">
        <div className="skills-settings-section-header">
          <div>
            <strong className="api-settings-form-section-title">
              {scopeTitle}
            </strong>
            <span>{scopeDescription}</span>
          </div>
          <div className="skills-settings-paths" aria-label={scopeTitle}>
            <code>.snow/skills/</code>
            <code>.agents/skills/</code>
          </div>
        </div>

        <div
          className="system-prompt-list mcp-server-list skills-settings-list"
          aria-live="polite"
        >
          {isLoading ? (
            <div className="system-prompt-empty skills-settings-empty">
              <Loader2 size={15} className="spin" />
              <span>
                {t("settings.skillsLoading", {
                  defaultValue: "Loading Skills...",
                })}
              </span>
            </div>
          ) : activeSkills.length === 0 ? (
            <div className="system-prompt-empty skills-settings-empty">
              <BookOpen size={15} />
              <span>
                {t(
                  isGlobalScope
                    ? "settings.skillsGlobalEmpty"
                    : "settings.skillsProjectEmpty",
                  {
                    defaultValue: isGlobalScope
                      ? "No global Skills found."
                      : "No project-only Skills found.",
                  }
                )}
              </span>
            </div>
          ) : (
            activeSkills.map((skill) => {
              const isUpdating = updatingSkillId === skill.id;
              const toggleLabel = skill.enabled
                ? t("settings.skillsDisable", { defaultValue: "Disable Skill" })
                : t("settings.skillsEnable", { defaultValue: "Enable Skill" });
              const stateLabel = skill.enabled
                ? t("settings.enabled", { defaultValue: "Enabled" })
                : t("settings.inactive", { defaultValue: "Disabled" });

              return (
                <div
                  className={`system-prompt-item skills-settings-item ${
                    skill.enabled ? "active" : "inactive"
                  }`}
                  key={skill.id}
                >
                  <div className="system-prompt-item-main skills-settings-item-main">
                    <label
                      className="toggle-switch system-prompt-switch skills-settings-switch"
                      aria-label={toggleLabel}
                      title={toggleLabel}
                    >
                      <input
                        type="checkbox"
                        checked={skill.enabled}
                        onChange={() => void toggleSkillEnabled(skill)}
                        disabled={isLoading || Boolean(updatingSkillId)}
                        hidden
                      />
                      <span className="toggle-slider" />
                      <span>{stateLabel}</span>
                    </label>
                    <div className="system-prompt-item-info skills-settings-item-info">
                      <div className="skills-settings-item-title">
                        <strong>{skill.name}</strong>
                        <code>{skill.id}</code>
                      </div>
                      <span className="skills-settings-item-description">
                        {skill.description ||
                          t("settings.skillsNoDescription", {
                            defaultValue: "No description provided.",
                          })}
                      </span>
                      <span className="skills-settings-item-path">
                        <Folder size={12} strokeWidth={1.8} />
                        <code title={skill.path}>{skill.path}</code>
                      </span>
                    </div>
                  </div>
                  <div className="system-prompt-item-actions skills-settings-item-actions">
                    {isUpdating && <Loader2 size={13} className="spin" />}
                    {skill.allowedTools && skill.allowedTools.length > 0 && (
                      <span
                        className="skills-settings-tools-count"
                        title={`${t("settings.skillsAllowedTools", {
                          defaultValue: "Allowed tools",
                        })}: ${skill.allowedTools.join(", ")}`}
                      >
                        <Wrench size={12} strokeWidth={1.8} />
                        {skill.allowedTools.length}
                      </span>
                    )}
                    <span className="skills-settings-badge">
                      .{skill.source}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
