import type { ProxyBrowserSettings } from "../../../../preload";
import { DEFAULT_PROXY_BROWSER_SETTINGS } from "./proxyBrowserSettingsConstants";
import type { ProxyBrowserSettingsForm } from "./types";

export const parsePort = (value: string, fallback: number): number => {
  const port = Number.parseInt(value, 10);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : fallback;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toText = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const toBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

export const normalizeProxyBrowserSettings = (
  value: unknown
): ProxyBrowserSettings => {
  const source = isRecord(value) ? value : {};

  return {
    enabled: toBoolean(source.enabled, DEFAULT_PROXY_BROWSER_SETTINGS.enabled),
    port: parsePort(String(source.port ?? ""), DEFAULT_PROXY_BROWSER_SETTINGS.port),
    browserPath: toText(source.browserPath).trim(),
    browserDebugPort: parsePort(
      String(source.browserDebugPort ?? ""),
      DEFAULT_PROXY_BROWSER_SETTINGS.browserDebugPort
    ),
    searchEngine:
      toText(source.searchEngine, DEFAULT_PROXY_BROWSER_SETTINGS.searchEngine).trim() ||
      DEFAULT_PROXY_BROWSER_SETTINGS.searchEngine,
  };
};

export const readProxyBrowserSettingsJson = (
  value: string | null
): ProxyBrowserSettings => {
  if (!value) {
    return DEFAULT_PROXY_BROWSER_SETTINGS;
  }

  try {
    return normalizeProxyBrowserSettings(JSON.parse(value) as unknown);
  } catch {
    return DEFAULT_PROXY_BROWSER_SETTINGS;
  }
};

export const toProxyBrowserForm = (
  settings: ProxyBrowserSettings
): ProxyBrowserSettingsForm => ({
  enabled: settings.enabled,
  port: String(settings.port),
  browserPath: settings.browserPath,
  browserDebugPort: String(settings.browserDebugPort),
  searchEngine: settings.searchEngine,
});

export const toProxyBrowserSettings = (
  form: ProxyBrowserSettingsForm
): ProxyBrowserSettings => ({
  enabled: form.enabled,
  port: parsePort(form.port, DEFAULT_PROXY_BROWSER_SETTINGS.port),
  browserPath: form.browserPath.trim(),
  browserDebugPort: parsePort(
    form.browserDebugPort,
    DEFAULT_PROXY_BROWSER_SETTINGS.browserDebugPort
  ),
  searchEngine: form.searchEngine.trim() || DEFAULT_PROXY_BROWSER_SETTINGS.searchEngine,
});
