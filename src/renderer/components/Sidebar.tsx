import { useCallback, useEffect, useState } from "react";
import { MainSidebarContent } from "./sidebar/MainSidebarContent";
import { ProjectExplorerContent } from "./sidebar/ProjectExplorerContent";
import { SettingsSidebarContent } from "./sidebar/SettingsSidebarContent";
import { shortcutEvents } from "./shortcutEvents";
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
    sshSessionId?: string | null,
    focusLine?: number
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

  // 订阅快捷键事件：Ctrl/Cmd+D 打开当前项目明细（Explorer 视图）。
  // 使用当前激活的工作区目录作为 explorer 目标。
  useEffect(() => {
    return shortcutEvents.on("open-project-explorer", () => {
      if (activeDirectory?.directoryId) {
        handleSwitchToExplorer(activeDirectory.directoryId);
      }
    });
  }, [activeDirectory, handleSwitchToExplorer]);

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
