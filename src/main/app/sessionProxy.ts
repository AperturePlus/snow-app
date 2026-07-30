import { session } from "electron";
import type { NativeBridge } from "../native/types";
import { snowLog } from "../../utils/snowLogger";
import {
  DEFAULT_PROXY_HOST,
  sanitizeProxyHost,
} from "../settings/proxyBrowserSettings";

const PROXY_BROWSER_SETTING_CODE = "proxy_browser_settings";

type ProxySettingsJson = {
  enabled?: boolean;
  host?: string;
  port?: number;
};

/**
 * 从数据库读取代理配置并应用到 Electron 默认会话。
 *
 * 应用后，所有通过 net.fetch / electron-updater / webview 发出的
 * 请求都会走配置的代理，与 Rust 后端的 reqwest 代理行为保持一致。
 */
export const applySessionProxy = async (
  native: NativeBridge
): Promise<void> => {
  try {
    const raw = await native.getSystemSettingValue(PROXY_BROWSER_SETTING_CODE);

    let enabled = false;
    let host = DEFAULT_PROXY_HOST;
    let port = 7890;

    if (raw) {
      try {
        const parsed = JSON.parse(raw) as ProxySettingsJson;
        enabled = parsed.enabled === true;
        host = sanitizeProxyHost(parsed.host);
        port =
          typeof parsed.port === "number" &&
          parsed.port >= 1 &&
          parsed.port <= 65535
            ? parsed.port
            : 7890;
      } catch {
        // JSON 解析失败，使用默认值（直连）
      }
    }

    if (enabled) {
      const proxyUrl = `http://${host}:${port}`;
      await session.defaultSession.setProxy({ proxyRules: proxyUrl });
      snowLog.info({
        module: "app/sessionProxy",
        func: "applySessionProxy",
        message: `Session proxy applied: ${proxyUrl}`,
      });
    } else {
      // 未启用内置代理时跟随操作系统代理设置
      await session.defaultSession.setProxy({ mode: "system" });
      snowLog.info({
        module: "app/sessionProxy",
        func: "applySessionProxy",
        message: "Session proxy set to system mode",
      });
    }
  } catch (error) {
    snowLog.error({
      module: "app/sessionProxy",
      func: "applySessionProxy",
      message: "Failed to apply session proxy",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
