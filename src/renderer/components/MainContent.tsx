import { ApiSettingsTreePanel } from "./sidebar/ApiSettingsTreePanel";
import { CodebaseSettingsPanel } from "./sidebar/CodebaseSettingsPanel";
import { CustomHeadersSettingsPanel } from "./sidebar/CustomHeadersSettingsPanel";
import { McpSettingsPanel } from "./sidebar/McpSettingsPanel";
import { ProxyBrowserSettingsPanel } from "./sidebar/ProxyBrowserSettingsPanel";
import { SensitiveCommandsPanel } from "./sidebar/SensitiveCommandsPanel";
import { SkillsSettingsPanel } from "./sidebar/SkillsSettingsPanel";
import { SubAgentSettingsPanel } from "./sidebar/SubAgentSettingsPanel";
import { SystemPromptSettingsPanel } from "./sidebar/SystemPromptSettingsPanel";
import { TerminalSettingsPanel } from "./sidebar/TerminalSettingsPanel";
import { ChatContent } from "./mainContent/ChatContent";
import type { MainContentView } from "./mainContent/types";
import type { WorkspaceDirectoryRecord } from "../../preload";

type MainContentProps = {
  activeDirectory?: WorkspaceDirectoryRecord | null;
  activeView: MainContentView;
  onSelectView: (view: MainContentView) => void;
};

export const MainContent = ({
  activeDirectory,
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
        <McpSettingsPanel
          activeDirectory={activeDirectory}
          onClose={() => onSelectView("chat")}
        />
      ) : activeView === "skills-settings" ? (
        <SkillsSettingsPanel
          activeDirectory={activeDirectory}
          onClose={() => onSelectView("chat")}
        />
      ) : activeView === "sub-agent-settings" ? (
        <SubAgentSettingsPanel
          activeDirectory={activeDirectory}
          onClose={() => onSelectView("chat")}
        />
      ) : activeView === "sensitive-command-settings" ? (
        <SensitiveCommandsPanel
          activeDirectory={activeDirectory}
          onClose={() => onSelectView("chat")}
        />
      ) : activeView === "terminal-settings" ? (
        <TerminalSettingsPanel onClose={() => onSelectView("chat")} />
      ) : (
        <ChatContent activeDirectory={activeDirectory} />
      )}
    </main>
  );
};
