import type { ProxyBrowserSettings } from "../../../../preload";

export type ProxyBrowserSettingsPanelProps = {
  onClose?: () => void;
};

export type ProxyBrowserSettingsForm = {
  enabled: boolean;
  port: string;
  browserPath: string;
  browserDebugPort: string;
  searchEngine: string;
};

export type ProxyBrowserSettingsValue = ProxyBrowserSettings;
