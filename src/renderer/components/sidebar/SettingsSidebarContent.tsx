import {
  ArrowLeft,
  ChartColumn,
  EyeOff,
  Globe,
  Link,
  List,
  MessageSquareText,
  Palette,
  Plug,
  Puzzle,
  Search,
  Sparkles,
  ShieldAlert,
  Terminal,
  Users,
} from "lucide-react";
import { localeLabels, useI18n, type Locale } from "../../i18n";
import type { SidebarContentProps } from "./types";

type SettingsItem = {
  id: string;
  icon: React.ComponentType<{
    size?: number;
    strokeWidth?: number;
    className?: string;
  }>;
  labelKey: string;
  defaultLabel: string;
};

const SETTINGS_ITEMS: SettingsItem[] = [
  {
    id: "api",
    icon: Plug,
    labelKey: "settings.apiSettings",
    defaultLabel: "API settings",
  },
  {
    id: "proxy",
    icon: Globe,
    labelKey: "settings.proxySettings",
    defaultLabel: "Proxy settings",
  },
  {
    id: "codebase",
    icon: Search,
    labelKey: "settings.codebaseSettings",
    defaultLabel: "Codebase settings",
  },
  {
    id: "systemprompt",
    icon: MessageSquareText,
    labelKey: "settings.systemPromptSettings",
    defaultLabel: "System prompt",
  },
  {
    id: "customheaders",
    icon: List,
    labelKey: "settings.customHeadersSettings",
    defaultLabel: "Custom headers",
  },
  {
    id: "mcp",
    icon: Puzzle,
    labelKey: "settings.mcpSettings",
    defaultLabel: "MCP settings",
  },
  {
    id: "skills",
    icon: Sparkles,
    labelKey: "settings.skillsSettings",
    defaultLabel: "Skills settings",
  },
  {
    id: "subagent",
    icon: Users,
    labelKey: "settings.subAgentSettings",
    defaultLabel: "Sub-agent settings",
  },
  {
    id: "sensitive-commands",
    icon: ShieldAlert,
    labelKey: "settings.sensitiveCommands",
    defaultLabel: "Sensitive commands",
  },
  {
    id: "hooks",
    icon: Link,
    labelKey: "settings.hooksSettings",
    defaultLabel: "Hooks settings",
  },
  {
    id: "theme",
    icon: Palette,
    labelKey: "settings.themeSettings",
    defaultLabel: "Theme settings",
  },
  {
    id: "terminal",
    icon: Terminal,
    labelKey: "settings.terminalSettings",
    defaultLabel: "Terminal settings",
  },
  {
    id: "privacy",
    icon: EyeOff,
    labelKey: "settings.privacySettings",
    defaultLabel: "Privacy settings",
  },
  {
    id: "usage",
    icon: ChartColumn,
    labelKey: "settings.usageSettings",
    defaultLabel: "Usage statistics",
  },
];

export function SettingsSidebarContent({
  activeMainView,
  onSelectMainView,
  onSwitchContent,
}: SidebarContentProps): React.JSX.Element {
  const { locale, setLocale, supportedLocales, t } = useI18n();

  const handleExitSettings = (): void => {
    onSwitchContent("main");

    if (
      activeMainView === "api-settings" ||
      activeMainView === "proxy-browser-settings" ||
      activeMainView === "codebase-settings" ||
      activeMainView === "system-prompt-settings" ||
      activeMainView === "custom-headers-settings" ||
      activeMainView === "mcp-settings" ||
      activeMainView === "skills-settings" ||
      activeMainView === "sub-agent-settings" ||
      activeMainView === "sensitive-command-settings" ||
      activeMainView === "hooks-settings" ||
      activeMainView === "terminal-settings" ||
      activeMainView === "theme-settings" ||
      activeMainView === "privacy-settings" ||
      activeMainView === "usage-settings"
    ) {
      onSelectMainView("chat");
    }
  };

  return (
    <>
      <div className="sidebar-content-header">
        <button
          className="icon-btn ghost"
          onClick={handleExitSettings}
          type="button"
          aria-label={t("settings.backToMain", {
            defaultValue: "Back to main sidebar",
          })}
        >
          <ArrowLeft size={16} strokeWidth={1.8} />
        </button>
        <span className="sidebar-content-title">
          {t("settings.title", { defaultValue: "Settings" })}
        </span>
      </div>

      <div className="settings-content">
        <div className="sidebar-section settings-menu-section">
          <div className="settings-list">
            {SETTINGS_ITEMS.map((item) => {
              const targetView =
                item.id === "api"
                  ? "api-settings"
                  : item.id === "proxy"
                  ? "proxy-browser-settings"
                  : item.id === "codebase"
                  ? "codebase-settings"
                  : item.id === "systemprompt"
                  ? "system-prompt-settings"
                  : item.id === "customheaders"
                  ? "custom-headers-settings"
                  : item.id === "mcp"
                  ? "mcp-settings"
                  : item.id === "skills"
                  ? "skills-settings"
                  : item.id === "subagent"
                  ? "sub-agent-settings"
                  : item.id === "sensitive-commands"
                  ? "sensitive-command-settings"
                  : item.id === "hooks"
                  ? "hooks-settings"
                  : item.id === "terminal"
                  ? "terminal-settings"
                  : item.id === "theme"
                  ? "theme-settings"
                  : item.id === "privacy"
                  ? "privacy-settings"
                  : item.id === "usage"
                  ? "usage-settings"
                  : null;
              const isActive = targetView === activeMainView;

              return (
                <button
                  key={item.id}
                  className={`settings-item ${isActive ? "active" : ""}`}
                  onClick={() => {
                    if (targetView) {
                      onSelectMainView(targetView);
                    }
                  }}
                  type="button"
                >
                  <item.icon
                    className="settings-item-icon"
                    size={16}
                    strokeWidth={1.8}
                  />
                  <span className="settings-item-content">
                    <span className="settings-item-title">
                      {t(item.labelKey, { defaultValue: item.defaultLabel })}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="sidebar-section">
          <div className="section-header">
            <span className="section-title">
              {t("settings.languageSettings", { defaultValue: "Language" })}
            </span>
          </div>
          <div className="settings-panel">
            <span className="settings-item-description">
              {t("settings.languageSettingsInfo", {
                defaultValue: "Choose the display language for Snow App.",
              })}
            </span>
            <div className="settings-language-options">
              {supportedLocales.map((supportedLocale) => (
                <button
                  key={supportedLocale}
                  className={`settings-language-option ${
                    locale === supportedLocale ? "active" : ""
                  }`}
                  onClick={() => setLocale(supportedLocale as Locale)}
                  type="button"
                >
                  {localeLabels[supportedLocale]}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
