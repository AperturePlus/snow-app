import type { ProxyBrowserSettings } from "../../../../preload";

export const PROXY_BROWSER_SETTING_NAME = "Proxy and browser settings";
export const PROXY_BROWSER_SETTING_CODE = "proxy_browser_settings";

export const DEFAULT_PROXY_BROWSER_SETTINGS: ProxyBrowserSettings = {
  enabled: false,
  port: 7890,
  browserPath: "",
  browserDebugPort: 9222,
  searchEngine: "duckduckgo",
};

export const SEARCH_ENGINE_OPTIONS = [
  { value: "duckduckgo", label: "DuckDuckGo" },
  { value: "bing", label: "Bing" },
];
