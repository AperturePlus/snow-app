import type { MainContentView } from "../mainContent/types";

export type SidebarContentKey = "main" | "settings";

export type SidebarContentProps = {
  activeMainView: MainContentView;
  onSelectMainView: (view: MainContentView) => void;
  onSwitchContent: (content: SidebarContentKey) => void;
};
