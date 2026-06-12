import { useState } from "react";
import { MainContent } from "./components/MainContent";
import { RightPanel } from "./components/RightPanel";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";

export const App = (): React.JSX.Element => {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isRightPanelCollapsed, setIsRightPanelCollapsed] = useState(false);
  const shellClasses = [
    "app-shell",
    isSidebarCollapsed ? "sidebar-collapsed" : "",
    isRightPanelCollapsed ? "right-panel-collapsed" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={shellClasses}>
      <TopBar
        isSidebarCollapsed={isSidebarCollapsed}
        isRightPanelCollapsed={isRightPanelCollapsed}
        onToggleSidebar={() =>
          setIsSidebarCollapsed((isCollapsed) => !isCollapsed)
        }
        onToggleRightPanel={() =>
          setIsRightPanelCollapsed((isCollapsed) => !isCollapsed)
        }
      />
      <div className="app-layout">
        <Sidebar isCollapsed={isSidebarCollapsed} />
        <MainContent />
        <RightPanel isCollapsed={isRightPanelCollapsed} />
      </div>
    </div>
  );
};
