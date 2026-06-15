import type { MainContentView } from "../mainContent/types";
import type { WorkspaceDirectoryRecord } from "../../../preload";

export type SidebarContentKey = "main" | "settings";

export type SidebarContentProps = {
  activeMainView: MainContentView;
  activeDirectory?: WorkspaceDirectoryRecord | null;
  onActiveDirectoryChange?: (
    directory: WorkspaceDirectoryRecord | null
  ) => void;
  onSelectMainView: (view: MainContentView) => void;
  onSwitchContent: (content: SidebarContentKey) => void;
};
