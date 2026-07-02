import { GitBranch, SidebarClose, SidebarOpen, SquarePen } from "lucide-react";
import { useEffect, useState } from "react";
import type { WorkspaceDirectoryRecord } from "../../preload";
import { useChatConversationContext } from "./mainContent/chatMessages";

type TopBarProps = {
  isSidebarCollapsed: boolean;
  isRightPanelCollapsed: boolean;
  activeDirectory?: WorkspaceDirectoryRecord | null;
  onToggleSidebar: () => void;
  onToggleRightPanel: () => void;
};

export const TopBar = ({
  isSidebarCollapsed,
  isRightPanelCollapsed,
  activeDirectory,
  onToggleSidebar,
  onToggleRightPanel,
}: TopBarProps): React.JSX.Element => {
  const { handleNewChat, summary, conversationDirectoryId } =
    useChatConversationContext();
  const [conversationDirectoryName, setConversationDirectoryName] = useState<
    string | undefined
  >(undefined);

  useEffect(() => {
    if (!conversationDirectoryId) {
      setConversationDirectoryName(undefined);
      return;
    }

    if (conversationDirectoryId === activeDirectory?.directoryId) {
      setConversationDirectoryName(activeDirectory.name);
      return;
    }

    let cancelled = false;

    void window.snow
      .listWorkspaceDirectories()
      .then((directories) => {
        if (cancelled) {
          return;
        }
        const matched = directories.find(
          (directory) => directory.directoryId === conversationDirectoryId
        );
        setConversationDirectoryName(matched?.name);
      })
      .catch(() => {
        // Silent fail
      });

    return () => {
      cancelled = true;
    };
  }, [conversationDirectoryId, activeDirectory]);

  const SidebarToggleIcon = isSidebarCollapsed ? SidebarOpen : SidebarClose;
  const sidebarToggleLabel = isSidebarCollapsed
    ? "Expand sidebar"
    : "Collapse sidebar";
  const RightPanelToggleIcon = isRightPanelCollapsed
    ? SidebarClose
    : SidebarOpen;
  const rightPanelToggleLabel = isRightPanelCollapsed
    ? "Expand right panel"
    : "Collapse right panel";

  const displayDirectoryName = conversationDirectoryId
    ? conversationDirectoryName
    : activeDirectory?.name;

  const headerTitle = summary || displayDirectoryName || "New Chat";
  const headerSubtitle = displayDirectoryName || "";

  return (
    <header className="top-bar">
      <div className="top-bar-left">
        <div className="top-bar-sidebar-actions" aria-label="Sidebar actions">
          <button
            className="icon-btn sidebar-toggle-btn"
            type="button"
            aria-label={sidebarToggleLabel}
            title={sidebarToggleLabel}
            onClick={onToggleSidebar}
          >
            <SidebarToggleIcon size={16} strokeWidth={1.8} />
          </button>
          <button
            className="icon-btn new-chat-btn"
            type="button"
            aria-label="New chat"
            title="New chat"
            onClick={handleNewChat}
          >
            <SquarePen size={16} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      <div className="top-bar-main">
        <div className="header-title-group">
          <h2 className="header-title">{headerTitle}</h2>
          {headerSubtitle ? (
            <span className="header-subtitle">{headerSubtitle}</span>
          ) : null}
        </div>
      </div>

      <div className="top-bar-right">
        <div className="top-bar-branch-info">
          {activeDirectory && (
            <span className="top-bar-branch-label">
              <GitBranch size={13} strokeWidth={1.8} />
              <span>{activeDirectory.name}</span>
            </span>
          )}
        </div>
        <button
          className="icon-btn ghost right-panel-toggle-btn"
          type="button"
          aria-label={rightPanelToggleLabel}
          title={rightPanelToggleLabel}
          onClick={onToggleRightPanel}
        >
          <RightPanelToggleIcon size={16} strokeWidth={1.8} />
        </button>
      </div>
    </header>
  );
};
