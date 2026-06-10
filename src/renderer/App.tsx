import { useState } from "react";
import { MainContent } from "./components/MainContent";
import { RightPanel } from "./components/RightPanel";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";

export const App = (): React.JSX.Element => {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isRightPanelCollapsed, setIsRightPanelCollapsed] = useState(false);

  return (
    <div
      className={`app-shell${
        isRightPanelCollapsed ? " right-panel-collapsed" : ""
      }`}
    >
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
