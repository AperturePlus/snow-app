import { ApiSettingsTreePanel } from "./sidebar/ApiSettingsTreePanel";
import { ChatContent } from "./mainContent/ChatContent";
import type { MainContentView } from "./mainContent/types";

type MainContentProps = {
  activeView: MainContentView;
  onSelectView: (view: MainContentView) => void;
};

export const MainContent = ({
  activeView,
  onSelectView,
}: MainContentProps): React.JSX.Element => {
  return (
    <main className="main-content">
      {activeView === "api-settings" ? (
        <ApiSettingsTreePanel onClose={() => onSelectView("chat")} />
      ) : (
        <ChatContent />
      )}
    </main>
  );
};
