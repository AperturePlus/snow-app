import { ApiSettingsTreePanel } from "./sidebar/ApiSettingsTreePanel";
import { CodebaseSettingsPanel } from "./sidebar/CodebaseSettingsPanel";
import { CustomHeadersSettingsPanel } from "./sidebar/CustomHeadersSettingsPanel";
import { McpSettingsPanel } from "./sidebar/McpSettingsPanel";
import { ProxyBrowserSettingsPanel } from "./sidebar/ProxyBrowserSettingsPanel";
import { SensitiveCommandsPanel } from "./sidebar/SensitiveCommandsPanel";
import { SystemPromptSettingsPanel } from "./sidebar/SystemPromptSettingsPanel";
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
      ) : activeView === "proxy-browser-settings" ? (
        <ProxyBrowserSettingsPanel onClose={() => onSelectView("chat")} />
      ) : activeView === "codebase-settings" ? (
        <CodebaseSettingsPanel onClose={() => onSelectView("chat")} />
      ) : activeView === "system-prompt-settings" ? (
        <SystemPromptSettingsPanel onClose={() => onSelectView("chat")} />
      ) : activeView === "custom-headers-settings" ? (
        <CustomHeadersSettingsPanel onClose={() => onSelectView("chat")} />
      ) : activeView === "mcp-settings" ? (
        <McpSettingsPanel onClose={() => onSelectView("chat")} />
      ) : activeView === "sensitive-command-settings" ? (
        <SensitiveCommandsPanel onClose={() => onSelectView("chat")} />
      ) : (
        <ChatContent />
      )}
    </main>
  );
};
