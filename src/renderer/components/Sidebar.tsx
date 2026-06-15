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

const SIDEBAR_CONTENTS: Record<
  SidebarContentKey,
  (props: SidebarContentProps) => React.JSX.Element
> = {
  main: MainSidebarContent,
  settings: SettingsSidebarContent,
};

export const Sidebar = ({
  activeMainView,
  activeDirectory,
  isCollapsed,
  onActiveDirectoryChange,
  onSelectMainView,
}: SidebarProps): React.JSX.Element => {
  const [activeContent, setActiveContent] = useState<SidebarContentKey>("main");
  const ActiveContent = SIDEBAR_CONTENTS[activeContent];

  return (
    <aside className={`sidebar ${isCollapsed ? "collapsed" : ""}`}>
      <ActiveContent
        activeDirectory={activeDirectory}
        activeMainView={activeMainView}
        onActiveDirectoryChange={onActiveDirectoryChange}
        onSelectMainView={onSelectMainView}
        onSwitchContent={setActiveContent}
      />
    </aside>
  );
};
