import { useState } from "react";
import { MainContent } from "./components/MainContent";
import { RightPanel } from "./components/RightPanel";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";

export const App = (): React.JSX.Element => {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  return (
    <div className="app-shell">
      <TopBar
        isSidebarCollapsed={isSidebarCollapsed}
        onToggleSidebar={() =>
          setIsSidebarCollapsed((isCollapsed) => !isCollapsed)
        }
      />
      <div className="app-layout">
        <Sidebar isCollapsed={isSidebarCollapsed} />
        <MainContent />
        <RightPanel />
      </div>
    </div>
  );
};
