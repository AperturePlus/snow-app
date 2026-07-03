import { GitPanelContent } from "./rightPanel/GitPanelContent";
import type { RightPanelContentProps } from "./rightPanel/types";

type RightPanelProps = RightPanelContentProps & {
  isCollapsed: boolean;
  isFullscreen: boolean;
};

export const RightPanel = ({
  isCollapsed,
  isFullscreen,
  activeDirectory,
}: RightPanelProps): React.JSX.Element => {
  const panelClasses = [
    "right-panel",
    isCollapsed ? "collapsed" : "",
    isFullscreen ? "fullscreen" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <aside className={panelClasses}>
      <div className="right-panel-content-wrapper">
        <GitPanelContent activeDirectory={activeDirectory} />
      </div>
    </aside>
  );
};
