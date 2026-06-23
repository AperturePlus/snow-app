import { Settings } from "lucide-react";
import { useState } from "react";

import { useI18n } from "../../i18n";
import { ChatsSection } from "./mainSidebar/ChatsSection";
import { PinnedSection } from "./mainSidebar/PinnedSection";
import { ProjectsSection } from "./mainSidebar/ProjectsSection";
import type { SidebarContentProps } from "./types";

export function MainSidebarContent({
  activeDirectory,
  onActiveDirectoryChange,
  onSwitchContent,
}: SidebarContentProps): React.JSX.Element {
  const { t } = useI18n();
  const [isSwitchingDirectory, setIsSwitchingDirectory] = useState(false);

  return (
    <>
      <PinnedSection
        activeDirectory={activeDirectory}
        isSwitchingDirectory={isSwitchingDirectory}
      />
      <ProjectsSection
        onActiveDirectoryChange={onActiveDirectoryChange}
        onSwitchingDirectoryChange={setIsSwitchingDirectory}
      />
      <ChatsSection
        activeDirectory={activeDirectory}
        isSwitchingDirectory={isSwitchingDirectory}
      />

      <div className="sidebar-footer">
        <button
          className="nav-item"
          onClick={() => onSwitchContent("settings")}
          type="button"
        >
          <Settings size={18} strokeWidth={1.8} />
          <span>{t("sidebar.settings", { defaultValue: "Settings" })}</span>
        </button>
      </div>
    </>
  );
}
