import { useEffect, useRef } from "react";
import type { BrowserCommandRequest } from "../../../../preload";
import {
  createBrowserInstanceId,
  executeBrowserMcpCommand,
  getFocusedBrowserInstanceId,
  parseBrowserMcpCommandArgs,
  waitForBrowserMcpInstance,
} from "./browserMcpController";

export type BrowserTabInfo = {
  instanceId: string;
  title: string;
  isActive: boolean;
};

export type BrowserMcpTabCallbacks = {
  openTab: (url?: string, instanceId?: string) => string;
  closeTab: (instanceId: string) => boolean;
  focusTab: (instanceId: string) => boolean;
  listTabs: () => BrowserTabInfo[];
};

const resolveInstanceId = (argsJson: string): string | null => {
  const args = parseBrowserMcpCommandArgs(argsJson);
  const requested =
    typeof args.instanceId === "string" ? args.instanceId.trim() : "";
  if (!requested || requested.toLowerCase() === "current") {
    return getFocusedBrowserInstanceId();
  }
  return requested;
};

export const useBrowserMcpCommandBridge = (
  callbacks: BrowserMcpTabCallbacks
): void => {
  // 通过 ref 持有最新的 callbacks，避免 effect 因 callbacks 引用变化
  // 而反复执行 cleanup/setup。cleanup 会触发 browser:renderer-unregister，
  // 导致主进程立即 reject 所有正在等待的浏览器命令（例如 create 正在
  // 等待 waitForBrowserMcpInstance 时被中断）。
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  useEffect(() => {
    return window.snow.registerBrowserCommandHandler(
      async (request: BrowserCommandRequest): Promise<string> => {
        const cb = callbacksRef.current;

        switch (request.operation) {
          case "create": {
            const args = parseBrowserMcpCommandArgs(request.argsJson);
            const url =
              typeof args.url === "string" ? args.url.trim() : undefined;
            const instanceId = createBrowserInstanceId();
            cb.openTab(url, instanceId);
            await waitForBrowserMcpInstance(instanceId);
            return JSON.stringify({
              instanceId,
              url: url || null,
              created: true,
            });
          }

          case "close": {
            const instanceId = resolveInstanceId(request.argsJson);
            if (!instanceId) {
              throw new Error(
                "No embedded browser is available to close; open a browser tab first"
              );
            }
            const closed = cb.closeTab(instanceId);
            if (!closed) {
              throw new Error(`Browser tab was not found: ${instanceId}`);
            }
            return JSON.stringify({
              instanceId,
              closed: true,
            });
          }

          case "focus": {
            const args = parseBrowserMcpCommandArgs(request.argsJson);
            const instanceId =
              typeof args.instanceId === "string"
                ? args.instanceId.trim()
                : "";
            if (!instanceId) {
              throw new Error("instanceId is required for browser-focus");
            }
            const focused = cb.focusTab(instanceId);
            if (!focused) {
              throw new Error(`Browser tab was not found: ${instanceId}`);
            }
            return JSON.stringify({
              instanceId,
              focused: true,
            });
          }

          case "list": {
            const tabs = cb.listTabs();
            return JSON.stringify({
              tabs,
              totalTabs: tabs.length,
            });
          }

          default:
            return executeBrowserMcpCommand(
              request.operation,
              request.argsJson
            );
        }
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
};
