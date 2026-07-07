import { ipcMain } from "electron";
import type { NativeBridge } from "../../native/types";
import {
  writeLog,
  type LogEntry,
  type LogLevel,
} from "../../../utils/snowLogger";

export const registerNativeHandlers = (native: NativeBridge): void => {
  ipcMain.handle("native:engine-info", () => native.engineInfo());
  ipcMain.handle(
    "settings:get-system-setting-value",
    async (_event, settingCode: string) =>
      native.getSystemSettingValue(settingCode)
  );
  ipcMain.handle(
    "settings:set-system-setting",
    async (
      _event,
      settingName: string,
      settingCode: string,
      settingValue: string
    ) => native.setSystemSetting(settingName, settingCode, settingValue)
  );

  ipcMain.handle("native:sum", (_event, a: number, b: number) =>
    native.sum(a, b)
  );
  ipcMain.handle("terminal:detect-terminals", () => native.detectTerminals());

  ipcMain.handle(
    "debug:write-log",
    (_event, level: unknown, entry: unknown) => {
      writeLog(level as LogLevel, entry as LogEntry);
    }
  );

  ipcMain.handle("mcp:list-tools", () => native.listMcpTools());
  ipcMain.handle(
    "mcp:call-tool",
    async (_event, toolFullName: unknown, argsJson: unknown) => {
      if (typeof toolFullName !== "string" || !toolFullName.trim()) {
        throw new Error("Tool full name is required");
      }
      if (typeof argsJson !== "string") {
        throw new Error("Arguments JSON string is required");
      }
      return native.callMcpTool(toolFullName.trim(), argsJson);
    }
  );
};
