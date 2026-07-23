import { Download, Search, Settings } from "lucide-react";
import { useEffect, useState } from "react";

import { useI18n } from "../../i18n";
import { useChatConversationContext } from "../mainContent/chatMessages";
import { ChatsSection } from "./mainSidebar/ChatsSection";
import { PinnedSection } from "./mainSidebar/PinnedSection";
import { ProjectsSection } from "./mainSidebar/ProjectsSection";
import { SearchModal } from "./SearchModal";
import type { SidebarContentProps } from "./types";
import type { UpdateStatus, ConversationSearchResult } from "../../../preload";

export function MainSidebarContent({
  activeDirectory,
  onActiveDirectoryChange,
  onSwitchContent,
  onSwitchToExplorer,
  onOpenSshWizard,
}: SidebarContentProps): React.JSX.Element {
  const { t } = useI18n();
  const { handleSelectConversation } = useChatConversationContext();
  const [isSwitchingDirectory, setIsSwitchingDirectory] = useState(false);
  const [appVersion, setAppVersion] = useState<string>("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({
    available: false,
    version: null,
    downloading: false,
    progress: 0,
    downloaded: false,
    error: null,
  });

  useEffect(() => {
    window.snow
      .getAppVersion()
      .then((version) => setAppVersion(version))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    window.snow
      .getUpdateStatus()
      .then(setUpdateStatus)
      .catch(() => undefined);
    const unsubscribe = window.snow.onUpdateStatusChanged((status) => {
      setUpdateStatus(status);
    });
    return unsubscribe;
  }, []);

  const handleDownloadUpdate = (): void => {
    void window.snow.downloadUpdate();
  };

  const handleInstallUpdate = (): void => {
    void window.snow.installUpdate();
  };

  const handleSearchSelect = (conversation: ConversationSearchResult): void => {
    void handleSelectConversation(
      conversation.conversationId,
      conversation.summary || conversation.title,
      {
        inputTokens: conversation.inputTokens,
        outputTokens: conversation.outputTokens,
        cacheCreationInputTokens: conversation.cacheCreationInputTokens,
        cacheReadInputTokens: conversation.cacheReadInputTokens,
      },
      conversation.directoryId
    );
  };

  return (
    <>
      <div className="sidebar-search-bar">
        <button
          className="nav-item sidebar-search-btn"
          onClick={() => setIsSearchOpen(true)}
          type="button"
        >
          <Search size={15} strokeWidth={1.8} />
          <span>
            {t("search.placeholder", {
              defaultValue: "Search conversations...",
            })}
          </span>
        </button>
      </div>
      <PinnedSection
        activeDirectory={activeDirectory}
        isSwitchingDirectory={isSwitchingDirectory}
      />
      <ProjectsSection
        onActiveDirectoryChange={onActiveDirectoryChange}
        onSwitchingDirectoryChange={setIsSwitchingDirectory}
        onSwitchContent={onSwitchContent}
        onSwitchToExplorer={onSwitchToExplorer}
        onOpenSshWizard={onOpenSshWizard}
      />
      <ChatsSection
        activeDirectory={activeDirectory}
        isSwitchingDirectory={isSwitchingDirectory}
      />

      <div className="sidebar-footer">
        <div className="sidebar-footer-row">
          <button
            className="nav-item"
            onClick={() => onSwitchContent("settings")}
            type="button"
          >
            <Settings size={18} strokeWidth={1.8} />
            <span>{t("sidebar.settings", { defaultValue: "Settings" })}</span>
          </button>
          {appVersion && (
            <span className="sidebar-version-badge">v{appVersion}</span>
          )}
        </div>
        {updateStatus.available &&
          !updateStatus.downloading &&
          !updateStatus.downloaded && (
            <button
              className="nav-item update-ready-btn"
              onClick={handleDownloadUpdate}
              type="button"
            >
              <Download size={16} strokeWidth={1.8} />
              <span>
                {t("sidebar.updateAvailable", {
                  defaultValue: "Update now",
                })}
              </span>
            </button>
          )}
        {updateStatus.available && updateStatus.downloading && (
          <div className="nav-item update-downloading">
            <Download size={16} strokeWidth={1.8} />
            <span>
              {t("sidebar.updateDownloading", {
                values: { percent: updateStatus.progress },
                defaultValue: `Downloading ${updateStatus.progress}%`,
              })}
            </span>
          </div>
        )}
        {updateStatus.downloaded && (
          <button
            className="nav-item update-ready-btn"
            onClick={handleInstallUpdate}
            type="button"
          >
            <Download size={16} strokeWidth={1.8} />
            <span>
              {t("sidebar.updateReady", { defaultValue: "Restart to update" })}
            </span>
          </button>
        )}
      </div>
      <SearchModal
        open={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onSelect={handleSearchSelect}
      />
    </>
  );
}
