import { useState } from "react";
import { MainSidebarContent } from "./sidebar/MainSidebarContent";
import { SettingsSidebarContent } from "./sidebar/SettingsSidebarContent";
import type { SidebarContentKey, SidebarContentProps } from "./sidebar/types";

type SidebarProps = {
  activeMainView: SidebarContentProps["activeMainView"];
  activeDirectory?: SidebarContentProps["activeDirectory"];
  isCollapsed: boolean;
  onActiveDirectoryChange?: SidebarContentProps["onActiveDirectoryChange"];
  onSelectMainView: SidebarContentProps["onSelectMainView"];
};

export const Sidebar = ({
  activeMainView,
  activeDirectory,
  isCollapsed,
  onActiveDirectoryChange,
  onSelectMainView,
}: SidebarProps): React.JSX.Element => {
  const [activeContent, setActiveContent] = useState<SidebarContentKey>("main");

  const sidebarProps: SidebarContentProps = {
    activeMainView,
    activeDirectory,
    onActiveDirectoryChange,
    onSelectMainView,
    onSwitchContent: setActiveContent,
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
    </aside>
  );
};
