import { FolderPlus, Loader2, Palette, Plug } from "lucide-react";
import { useCallback, useState } from "react";

import type { MainContentView } from "./types";
import type { WorkspaceDirectoryRecord } from "../../../preload";
import { useI18n } from "../../i18n";
import { PixelLogo } from "../common/PixelLogo";

type EmptyChatGreetingProps = {
  activeDirectory?: WorkspaceDirectoryRecord | null;
  onNavigateToView?: (view: MainContentView) => void;
};

export function EmptyChatGreeting({
  activeDirectory,
  onNavigateToView,
}: EmptyChatGreetingProps): React.JSX.Element {
  const { t } = useI18n();
  const [isAddingProject, setIsAddingProject] = useState(false);
  const [addProjectError, setAddProjectError] = useState<string | null>(null);

  const handleAddProject = useCallback(async (): Promise<void> => {
    if (isAddingProject) {
      return;
    }

    setIsAddingProject(true);
    setAddProjectError(null);

    try {
      const selectedPath = await window.snow.selectWorkspaceDirectory(
        t("sidebar.selectLocalDirectoryTitle", {
          defaultValue: "Select local workspace directory",
        })
      );

      if (selectedPath) {
        const trimmedPath = selectedPath.trim();
        const name =
          trimmedPath.split(/[\\/]/).filter(Boolean).pop() || trimmedPath;
        await window.snow.upsertWorkspaceDirectory({
          directoryId: `local:${trimmedPath}`,
          name,
          path: trimmedPath,
          kind: "local",
          isActive: true,
          sortOrder: 0,
          source: "manual",
        });
      }
    } catch (error) {
      setAddProjectError(
        error instanceof Error
          ? error.message
          : t("sidebar.addDirectoryError", {
              defaultValue: "Failed to add workspace directory",
            })
      );
    } finally {
      setIsAddingProject(false);
    }
  }, [isAddingProject, t]);

  return (
    <div className="chat-empty-greeting">
      <div className="chat-empty-greeting-brand">
        <PixelLogo className="chat-empty-greeting-logo" />
      </div>
      <p className="chat-empty-greeting-title">
        {activeDirectory
          ? t("chat.greetingWithProject", {
              defaultValue: "What would you like to work on in {{name}}?",
              values: { name: activeDirectory.name },
            })
          : t("chat.greetingNoProject", {
              defaultValue: "Select a workspace project to get started.",
            })}
      </p>
      <div className="chat-empty-quick-actions">
        <button
          className="chat-empty-quick-card"
          type="button"
          disabled={isAddingProject}
          onClick={() => void handleAddProject()}
        >
          <span className="chat-empty-quick-card-icon">
            {isAddingProject ? (
              <Loader2 size={15} strokeWidth={1.8} className="spin" />
            ) : (
              <FolderPlus size={15} strokeWidth={1.8} />
            )}
          </span>
          <span className="chat-empty-quick-card-text">
            <span className="chat-empty-quick-card-title">
              {t("chat.quickActionAddProject", {
                defaultValue: "Add a project",
              })}
            </span>
            <span className="chat-empty-quick-card-desc">
              {t("chat.quickActionAddProjectDesc", {
                defaultValue: "Open a local workspace directory",
              })}
            </span>
          </span>
        </button>
        <button
          className="chat-empty-quick-card is-api"
          type="button"
          onClick={() => onNavigateToView?.("api-settings")}
        >
          <span className="chat-empty-quick-card-icon">
            <Plug size={15} strokeWidth={1.8} />
          </span>
          <span className="chat-empty-quick-card-text">
            <span className="chat-empty-quick-card-title">
              {t("chat.quickActionConfigApi", {
                defaultValue: "Configure AI API",
              })}
            </span>
            <span className="chat-empty-quick-card-desc">
              {t("chat.quickActionConfigApiDesc", {
                defaultValue: "Set up providers, models and credentials",
              })}
            </span>
          </span>
        </button>
        <button
          className="chat-empty-quick-card is-theme"
          type="button"
          onClick={() => onNavigateToView?.("theme-settings")}
        >
          <span className="chat-empty-quick-card-icon">
            <Palette size={15} strokeWidth={1.8} />
          </span>
          <span className="chat-empty-quick-card-text">
            <span className="chat-empty-quick-card-title">
              {t("chat.quickActionCustomizeTheme", {
                defaultValue: "Customize appearance",
              })}
            </span>
            <span className="chat-empty-quick-card-desc">
              {t("chat.quickActionCustomizeThemeDesc", {
                defaultValue: "Choose theme, light or dark mode",
              })}
            </span>
          </span>
        </button>
      </div>
      {addProjectError ? (
        <p className="chat-empty-quick-error">{addProjectError}</p>
      ) : null}
    </div>
  );
}
