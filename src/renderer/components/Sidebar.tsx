import { useCallback, useState } from "react";
import { MainSidebarContent } from "./sidebar/MainSidebarContent";
import { ProjectExplorerContent } from "./sidebar/ProjectExplorerContent";
import { SettingsSidebarContent } from "./sidebar/SettingsSidebarContent";
import type { SidebarContentKey, SidebarContentProps } from "./sidebar/types";

type SidebarProps = {
  activeMainView: SidebarContentProps["activeMainView"];
  activeDirectory?: SidebarContentProps["activeDirectory"];
  isCollapsed: boolean;
  onActiveDirectoryChange?: SidebarContentProps["onActiveDirectoryChange"];
  onSelectMainView: SidebarContentProps["onSelectMainView"];
  onOpenSshWizard?: () => void;
  onOpenFile?: (
    filePath: string,
    fileName: string,
    isSsh?: boolean,
    sshSessionId?: string | null
  ) => void;
};

export const Sidebar = ({
  activeMainView,
  activeDirectory,
  isCollapsed,
  onActiveDirectoryChange,
  onSelectMainView,
  onOpenSshWizard,
  onOpenFile,
}: SidebarProps): React.JSX.Element => {
  const [activeContent, setActiveContent] = useState<SidebarContentKey>("main");
  const [explorerDirectoryId, setExplorerDirectoryId] = useState<string | null>(
    null
  );

  const handleSwitchContent = useCallback(
    (content: SidebarContentKey): void => {
      if (content === "explorer") {
        // explorerDirectoryId is set separately via onSwitchToExplorer
        setActiveContent("explorer");
        return;
      }
      setActiveContent(content);
    },
    []
  );

  const handleSwitchToExplorer = useCallback((directoryId: string): void => {
    setExplorerDirectoryId(directoryId);
    setActiveContent("explorer");
  }, []);

  const sidebarProps: SidebarContentProps = {
    activeMainView,
    activeDirectory,
    explorerDirectoryId,
    onActiveDirectoryChange,
    onSelectMainView,
    onSwitchContent: handleSwitchContent,
    onSwitchToExplorer: handleSwitchToExplorer,
    onOpenSshWizard,
    onOpenFile,
  };

  return (
    <aside className={`sidebar ${isCollapsed ? "collapsed" : ""}`}>
      <div
        className={`sidebar-content-wrapper ${
          activeContent === "main" ? "" : "is-hidden"
        }`}
      >
        <MainSidebarContent {...sidebarProps} />
      </div>
      <div
        className={`sidebar-content-wrapper ${
          activeContent === "settings" ? "" : "is-hidden"
        }`}
      >
        <SettingsSidebarContent {...sidebarProps} />
      </div>
      <div
        className={`sidebar-content-wrapper ${
          activeContent === "explorer" ? "" : "is-hidden"
        }`}
      >
        <ProjectExplorerContent {...sidebarProps} />
      </div>
    </aside>
  );
};
