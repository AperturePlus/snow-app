import { useEffect } from "react";
import type { BrowserCommandRequest } from "../../../../preload";
import {
  createBrowserInstanceId,
  executeBrowserMcpCommand,
  parseBrowserMcpCommandArgs,
  waitForBrowserMcpInstance,
} from "./browserMcpController";

type OpenBrowserInstance = (url?: string, instanceId?: string) => string;

export const useBrowserMcpCommandBridge = (
  openBrowserInstance: OpenBrowserInstance
): void => {
  useEffect(() => {
    return window.snow.registerBrowserCommandHandler(
      async (request: BrowserCommandRequest): Promise<string> => {
        if (request.operation !== "create") {
          return executeBrowserMcpCommand(request.operation, request.argsJson);
        }

        const args = parseBrowserMcpCommandArgs(request.argsJson);
        const url = typeof args.url === "string" ? args.url.trim() : undefined;
        const instanceId = createBrowserInstanceId();
        openBrowserInstance(url, instanceId);
        await waitForBrowserMcpInstance(instanceId);
        return JSON.stringify({
          instanceId,
          url: url || null,
          created: true,
        });
      }
    );
  }, [openBrowserInstance]);
};
