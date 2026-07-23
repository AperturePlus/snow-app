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
import { CodebaseSyncIndicator } from "./TopBar/CodebaseSyncIndicator";
import { TodoPanelButton } from "./TopBar/TodoPanelButton";
import { useCodebaseWatcher } from "../hooks/useCodebaseWatcher";

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
  const {
    handleNewChat,
    summary,
    conversationDirectoryId,
    activeConversationId,
    messages,
    isStreaming,
  } = useChatConversationContext();
  const [conversationDirectoryName, setConversationDirectoryName] = useState<
    string | undefined
  >(undefined);
  const [isPlusMenuOpen, setIsPlusMenuOpen] = useState(false);
  const [isTodoPanelOpen, setIsTodoPanelOpen] = useState(false);
  const [codebaseEnabled, setCodebaseEnabled] = useState(false);
  // Track which projectId the codebaseEnabled state corresponds to. This is
  // used to detect stale enabled values during project switches — when the
  // active project changes, codebaseEnabled may still hold the previous
  // project's value for one render cycle (React state updates are async).
  // By comparing enabledProjectIdRef with activeProjectId, we can force
  // enabled=false until the new project's scope is confirmed.
  const enabledProjectIdRef = useRef<string | undefined>(undefined);
  const plusMenuRef = useRef<HTMLDivElement>(null);

  // Resolve the active project id / path for the codebase watcher. Prefer the
  // conversation's directory (so the watcher follows the active chat), falling
  // back to the active workspace directory.
  const activeProjectId =
    conversationDirectoryId ?? activeDirectory?.directoryId;
  const activeProjectPath = activeDirectory?.path;

  // Load the codebase scope settings for the active project to determine
  // whether the watcher should be active.
  //
  // When the active project changes, we immediately reset codebaseEnabled to
  // false and clear enabledProjectIdRef BEFORE the async fetch resolves. This
  // prevents the useCodebaseWatcher from briefly starting a watcher for the
  // new project using the stale `true` value from the previous project.
  useEffect(() => {
    if (!activeProjectId) {
      setCodebaseEnabled(false);
      enabledProjectIdRef.current = undefined;
      return;
    }

    // Reset to false immediately so the watcher stops while we fetch the
    // new project's scope. Also clear the ref so that even if the state
    // update hasn't flushed yet, the derived `effectiveEnabled` below
    // will be false.
    setCodebaseEnabled(false);
    enabledProjectIdRef.current = undefined;

    let cancelled = false;
    void window.snow
      .getCodebaseProjectScopeSettings(activeProjectId)
      .then((scope) => {
        if (!cancelled) {
          enabledProjectIdRef.current = activeProjectId;
          setCodebaseEnabled(scope.enabled ?? false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          enabledProjectIdRef.current = activeProjectId;
          setCodebaseEnabled(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeProjectId]);

  // Listen for codebase scope changes broadcast by the backend (e.g. when
  // the user toggles the enabled switch in ProjectCodebasePanel). This keeps
  // the TopBar indicator in sync without requiring a manual refresh.
  useEffect(() => {
    const dispose = window.snow.onCodebaseScopeChanged((payload) => {
      if (payload.key === "enabled" && payload.projectId === activeProjectId) {
        enabledProjectIdRef.current = activeProjectId;
        setCodebaseEnabled(payload.enabled);
      }
    });
    return () => {
      dispose();
    };
  }, [activeProjectId]);

  // Derive the effective enabled state: only treat codebaseEnabled as true
  // if it was confirmed for the currently active project. This guards against
  // the React state batch-update race where activeProjectId changes but
  // codebaseEnabled still holds the previous project's value.
  const effectiveEnabled =
    codebaseEnabled && enabledProjectIdRef.current === activeProjectId;

  const { syncStatus, watchedProjectId } = useCodebaseWatcher({
    projectId: activeProjectId,
    projectPath: activeProjectPath,
    enabled: effectiveEnabled,
  });

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
    <header
      className={`top-bar${isPlusMenuOpen ? " plus-menu-open" : ""}${
        isTodoPanelOpen ? " todo-panel-open" : ""
      }`}
    >
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
        <TodoPanelButton
          messages={messages}
          conversationId={activeConversationId}
          projectId={conversationDirectoryId ?? activeDirectory?.directoryId}
          isRunning={isStreaming}
          onOpenChange={setIsTodoPanelOpen}
        />
        <CodebaseSyncIndicator
          syncStatus={syncStatus}
          watchedProjectId={watchedProjectId}
          activeProjectId={activeProjectId}
        />
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
