import {
  GitBranch,
  Globe,
  Maximize2,
  Minimize2,
  Plus,
  SidebarClose,
  SidebarOpen,
  SquarePen,
  Terminal,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { WorkspaceDirectoryRecord } from "../../preload";
import { useChatConversationContext } from "./mainContent/chatMessages";

type TopBarProps = {
  isSidebarCollapsed: boolean;
  isRightPanelCollapsed: boolean;
  isRightPanelFullscreen: boolean;
  activeDirectory?: WorkspaceDirectoryRecord | null;
  onToggleSidebar: () => void;
  onToggleRightPanel: () => void;
  onToggleRightPanelFullscreen: () => void;
  onOpenTerminal?: () => void;
  onOpenBrowser?: () => void;
};

export const TopBar = ({
  isSidebarCollapsed,
  isRightPanelCollapsed,
  isRightPanelFullscreen,
  activeDirectory,
  onToggleSidebar,
  onToggleRightPanel,
  onToggleRightPanelFullscreen,
  onOpenTerminal,
  onOpenBrowser,
}: TopBarProps): React.JSX.Element => {
  const { handleNewChat, summary, conversationDirectoryId } =
    useChatConversationContext();
  const [conversationDirectoryName, setConversationDirectoryName] = useState<
    string | undefined
  >(undefined);
  const [isPlusMenuOpen, setIsPlusMenuOpen] = useState(false);
  const plusMenuRef = useRef<HTMLDivElement>(null);

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
  const FullscreenToggleIcon = isRightPanelFullscreen ? Minimize2 : Maximize2;
  const fullscreenToggleLabel = isRightPanelFullscreen
    ? "Exit right panel fullscreen"
    : "Right panel fullscreen";

  const displayDirectoryName = conversationDirectoryId
    ? conversationDirectoryName
    : activeDirectory?.name;

  const headerTitle = summary || displayDirectoryName || "New Chat";
  const headerSubtitle = displayDirectoryName || "";

  useEffect(() => {
    if (!isPlusMenuOpen) {
      return undefined;
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (
        plusMenuRef.current &&
        !plusMenuRef.current.contains(event.target as Node)
      ) {
        setIsPlusMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", handleClickOutside, true);
    return () => {
      document.removeEventListener("pointerdown", handleClickOutside, true);
    };
  }, [isPlusMenuOpen]);

  const plusMenuItems = [
    { id: "terminal", label: "终端", icon: Terminal },
    { id: "browser", label: "浏览器", icon: Globe },
  ];

  const handlePlusMenuAction = (actionId: string): void => {
    if (actionId === "terminal") {
      onOpenTerminal?.();
    } else if (actionId === "browser") {
      onOpenBrowser?.();
    }
    setIsPlusMenuOpen(false);
  };

  return (
    <header className={`top-bar${isPlusMenuOpen ? " plus-menu-open" : ""}`}>
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
        <div className="top-bar-right-actions">
          <div className="top-bar-plus-menu" ref={plusMenuRef}>
            <button
              className={`icon-btn ghost top-bar-plus-btn${
                isPlusMenuOpen ? " active" : ""
              }`}
              type="button"
              aria-label="New tab"
              title="New tab"
              aria-expanded={isPlusMenuOpen}
              onClick={() => setIsPlusMenuOpen((open) => !open)}
            >
              <Plus size={16} strokeWidth={1.8} />
            </button>
            {isPlusMenuOpen && (
              <div className="top-bar-plus-dropdown">
                {plusMenuItems.map((item) => {
                  const ItemIcon = item.icon;
                  return (
                    <button
                      key={item.id}
                      className="top-bar-plus-dropdown-item"
                      type="button"
                      onClick={() => handlePlusMenuAction(item.id)}
                    >
                      <ItemIcon size={13} strokeWidth={1.8} />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          {!isRightPanelFullscreen && (
            <button
              className="icon-btn ghost right-panel-toggle-btn"
              type="button"
              aria-label={rightPanelToggleLabel}
              title={rightPanelToggleLabel}
              onClick={onToggleRightPanel}
            >
              <RightPanelToggleIcon size={16} strokeWidth={1.8} />
            </button>
          )}
          <button
            className="icon-btn ghost right-panel-fullscreen-btn"
            type="button"
            aria-label={fullscreenToggleLabel}
            title={fullscreenToggleLabel}
            onClick={onToggleRightPanelFullscreen}
          >
            <FullscreenToggleIcon size={16} strokeWidth={1.8} />
          </button>
        </div>
      </div>
    </header>
  );
};
