import type { ProxyBrowserSettings } from "../../../../preload";

export type ProxyBrowserSettingsPanelProps = {
  onClose?: () => void;
};

export type ProxyBrowserSettingsForm = {
  enabled: boolean;
  host: string;
  port: string;
  browserPath: string;
  browserDebugPort: string;
  searchEngine: string;
};

export type ProxyBrowserSettingsValue = ProxyBrowserSettings;
