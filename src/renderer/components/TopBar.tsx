import {
  ChevronDown,
  GitBranch,
  GitPullRequest,
  Maximize2,
  Settings,
  SidebarClose,
  SidebarOpen,
  SquareStack,
} from "lucide-react";

type TopBarProps = {
  isSidebarCollapsed: boolean;
  onToggleSidebar: () => void;
};

export const TopBar = ({
  isSidebarCollapsed,
  onToggleSidebar,
}: TopBarProps): React.JSX.Element => {
  const ToggleIcon = isSidebarCollapsed ? SidebarOpen : SidebarClose;
  const toggleLabel = isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar";

  return (
    <header className="top-bar">
      <div className="top-bar-left">
        <div className="top-bar-sidebar-actions" aria-label="Sidebar actions">
          <button
            className="icon-btn sidebar-toggle-btn"
            type="button"
            aria-label={toggleLabel}
            title={toggleLabel}
            onClick={onToggleSidebar}
          >
            <ToggleIcon size={16} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      <div className="top-bar-main">
        <div className="header-title-group">
          <h2 className="header-title">Redesign app modern UI</h2>
          <span className="header-subtitle">burger-restaurant</span>
        </div>
        <div className="header-actions">
          <button className="icon-btn ghost" aria-label="Settings">
            <Settings size={16} />
          </button>
          <button className="icon-btn ghost" aria-label="Branch">
            <GitBranch size={16} />
          </button>
          <button className="btn-commit">
            <GitBranch size={14} />
            <span>Commit</span>
            <ChevronDown size={12} />
          </button>
          <button className="icon-btn ghost" aria-label="Maximize">
            <Maximize2 size={16} />
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
          <button className="panel-tab-btn" aria-label="Add tab">
            <span>+</span>
          </button>
        </div>
        <button className="icon-btn ghost" aria-label="Expand">
          <span>⤢</span>
        </button>
      </div>
    </header>
  );
};
