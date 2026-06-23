import {
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { MainContent } from "./components/MainContent";
import { RightPanel } from "./components/RightPanel";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { ChatConversationProvider } from "./components/mainContent/chatMessages";
import type { MainContentView } from "./components/mainContent/types";
import type { WorkspaceDirectoryRecord } from "../preload";

const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_MAX_WIDTH = 420;
const SIDEBAR_DEFAULT_WIDTH = 248;
const RIGHT_PANEL_MIN_WIDTH = 280;
const RIGHT_PANEL_MAX_WIDTH = 640;
const RIGHT_PANEL_DEFAULT_WIDTH = 380;
const MAIN_CONTENT_MIN_WIDTH = 420;
const APP_LAYOUT_HORIZONTAL_PADDING = 20;
const APP_LAYOUT_GAP_TOTAL = 20;

type ResizeTarget = "sidebar" | "right-panel";

type PanelSizeStyle = CSSProperties & {
  "--sidebar-width": string;
  "--right-panel-width": string;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

export const App = (): React.JSX.Element => {
  const [activeMainView, setActiveMainView] = useState<MainContentView>("chat");
  const [activeDirectory, setActiveDirectory] =
    useState<WorkspaceDirectoryRecord | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isRightPanelCollapsed, setIsRightPanelCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const [rightPanelWidth, setRightPanelWidth] = useState(
    RIGHT_PANEL_DEFAULT_WIDTH
  );
  const [activeResizeTarget, setActiveResizeTarget] =
    useState<ResizeTarget | null>(null);
  const shellClasses = [
    "app-shell",
    isSidebarCollapsed ? "sidebar-collapsed" : "",
    isRightPanelCollapsed ? "right-panel-collapsed" : "",
    activeResizeTarget ? "is-resizing" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const panelSizeStyle: PanelSizeStyle = {
    "--sidebar-width": `${sidebarWidth}px`,
    "--right-panel-width": `${rightPanelWidth}px`,
  };

  const getMaxPanelWidth = (target: ResizeTarget): number => {
    const visibleSidebarWidth = isSidebarCollapsed ? 0 : sidebarWidth;
    const visibleRightPanelWidth = isRightPanelCollapsed ? 0 : rightPanelWidth;
    const otherPanelWidth =
      target === "sidebar" ? visibleRightPanelWidth : visibleSidebarWidth;
    const absoluteMax =
      target === "sidebar" ? SIDEBAR_MAX_WIDTH : RIGHT_PANEL_MAX_WIDTH;
    const minWidth =
      target === "sidebar" ? SIDEBAR_MIN_WIDTH : RIGHT_PANEL_MIN_WIDTH;
    const availableWidth =
      window.innerWidth - APP_LAYOUT_HORIZONTAL_PADDING - APP_LAYOUT_GAP_TOTAL;
    const mainSafeMax =
      availableWidth - otherPanelWidth - MAIN_CONTENT_MIN_WIDTH;

    return Math.max(minWidth, Math.min(absoluteMax, mainSafeMax));
  };

  const startPanelResize = (
    target: ResizeTarget,
    event: ReactPointerEvent<HTMLDivElement>
  ): void => {
    event.preventDefault();

    const startX = event.clientX;
    const startWidth = target === "sidebar" ? sidebarWidth : rightPanelWidth;

    setActiveResizeTarget(target);
    event.currentTarget.setPointerCapture(event.pointerId);

    const handlePointerMove = (pointerEvent: PointerEvent): void => {
      const deltaX = pointerEvent.clientX - startX;
      const nextWidth =
        target === "sidebar" ? startWidth + deltaX : startWidth - deltaX;
      const minWidth =
        target === "sidebar" ? SIDEBAR_MIN_WIDTH : RIGHT_PANEL_MIN_WIDTH;
      const maxWidth = getMaxPanelWidth(target);
      const clampedWidth = Math.round(clamp(nextWidth, minWidth, maxWidth));

      if (target === "sidebar") {
        setSidebarWidth(clampedWidth);
      } else {
        setRightPanelWidth(clampedWidth);
      }
    };

    const stopResize = (): void => {
      setActiveResizeTarget(null);
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", stopResize);
      document.removeEventListener("pointercancel", stopResize);
    };

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", stopResize);
    document.addEventListener("pointercancel", stopResize);
  };

  return (
    <ChatConversationProvider directoryId={activeDirectory?.directoryId}>
      <div className={shellClasses} style={panelSizeStyle}>
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
          <Sidebar
            activeDirectory={activeDirectory}
            activeMainView={activeMainView}
            isCollapsed={isSidebarCollapsed}
            onActiveDirectoryChange={setActiveDirectory}
            onSelectMainView={setActiveMainView}
          />
          {!isSidebarCollapsed && (
            <div
              className="panel-resizer sidebar-resizer layout-resizer"
              role="separator"
              aria-label="Resize sidebar"
              aria-orientation="vertical"
              onPointerDown={(event) => startPanelResize("sidebar", event)}
            />
          )}
          <MainContent
            activeDirectory={activeDirectory}
            activeView={activeMainView}
            onSelectView={setActiveMainView}
          />
          {!isRightPanelCollapsed && (
            <div
              className="panel-resizer right-panel-resizer layout-resizer"
              role="separator"
              aria-label="Resize review panel"
              aria-orientation="vertical"
              onPointerDown={(event) => startPanelResize("right-panel", event)}
            />
          )}
          <RightPanel isCollapsed={isRightPanelCollapsed} />
        </div>
      </div>
    </ChatConversationProvider>
  );
};
