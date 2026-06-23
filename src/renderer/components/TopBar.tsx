import {
  ChevronDown,
  GitBranch,
  GitPullRequest,
  SidebarClose,
  SidebarOpen,
  SquarePen,
  SquareStack,
} from "lucide-react";
import { useChatConversationContext } from "./mainContent/chatMessages";

type TopBarProps = {
  isSidebarCollapsed: boolean;
  isRightPanelCollapsed: boolean;
  onToggleSidebar: () => void;
  onToggleRightPanel: () => void;
};

export const TopBar = ({
  isSidebarCollapsed,
  isRightPanelCollapsed,
  onToggleSidebar,
  onToggleRightPanel,
}: TopBarProps): React.JSX.Element => {
  const { handleNewChat } = useChatConversationContext();
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
          <h2 className="header-title">Redesign app modern UI</h2>
          <span className="header-subtitle">burger-restaurant</span>
        </div>
        <div className="header-actions">
          <button className="icon-btn ghost" aria-label="Branch">
            <GitBranch size={16} />
          </button>
          <button className="btn-commit">
            <GitBranch size={14} />
            <span>Commit</span>
            <ChevronDown size={12} />
          </button>
          <div className="diff-stat">
            <span className="diff-add">+938</span>
            <span className="diff-del">-664</span>
          </div>
        </div>
      </div>

      <div className="top-bar-right">
        <div className="panel-tab-group">
          <button className="panel-tab">
            <GitPullRequest size={16} />
            <span>Review</span>
          </button>
          <button className="panel-tab active">
            <SquareStack size={16} />
            <span>Review</span>
          </button>
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
