import { BrowserWindow, dialog, ipcMain } from "electron";
import type { NativeBridge } from "../native/types";
import { normalizeApiConfigInput, toApiConfigInput } from "../settings/apiConfigs";
import {
  normalizeCodebaseSettings,
  persistCodebaseSettings,
  readSnowCliCodebaseSettings,
} from "../settings/codebaseSettings";
import { readSnowCliProxyConfig } from "../settings/proxyBrowserSettings";
import { readSnowCliProfiles } from "../snowCli/profiles";

export const registerIpcHandlers = (native: NativeBridge): void => {
  ipcMain.handle("native:engine-info", () => native.engineInfo());
  ipcMain.handle(
    "settings:get-system-setting-value",
    (_event, settingCode: string) => native.getSystemSettingValue(settingCode)
  );
  ipcMain.handle(
    "settings:set-system-setting",
    (_event, settingName: string, settingCode: string, settingValue: string) =>
      native.setSystemSetting(settingName, settingCode, settingValue)
  );
  ipcMain.handle("api-configs:list", () => native.listApiConfigs());
  ipcMain.handle("api-configs:upsert", (_event, config: unknown) => {
    native.upsertApiConfig(normalizeApiConfigInput(config));
    return native.listApiConfigs();
  });
  ipcMain.handle("api-configs:delete", (_event, profileName: unknown) => {
    if (typeof profileName !== "string" || !profileName.trim()) {
      throw new Error("Profile name is required");
    }

    native.deleteApiConfig(profileName.trim());
    return native.listApiConfigs();
  });
  ipcMain.handle("api-configs:import-snow-cli", () => {
    const profiles = readSnowCliProfiles();

    for (const profile of profiles) {
      native.upsertApiConfig(toApiConfigInput(profile));
    }

    return {
      importedCount: profiles.length,
      configs: native.listApiConfigs(),
    };
  });
  ipcMain.handle("proxy-browser-settings:import-snow-cli", () =>
    readSnowCliProxyConfig(native)
  );
  ipcMain.handle("codebase-settings:get", () => native.getCodebaseSettings());
  ipcMain.handle("codebase-settings:upsert", (_event, settings: unknown) =>
    persistCodebaseSettings(native, normalizeCodebaseSettings(settings))
  );
  ipcMain.handle("codebase-settings:import-snow-cli", () =>
    readSnowCliCodebaseSettings(native)
  );
  ipcMain.handle(
    "proxy-browser-settings:select-browser-executable",
    async (event, dialogTitle: unknown) => {
      const browserWindow = BrowserWindow.fromWebContents(event.sender);
      const title =
        typeof dialogTitle === "string" && dialogTitle.trim()
          ? dialogTitle.trim()
          : "Select browser executable";
      const options: Electron.OpenDialogOptions = {
        title,
        properties: ["openFile"],
        filters:
          process.platform === "win32"
            ? [
                { name: "Applications", extensions: ["exe"] },
                { name: "All files", extensions: ["*"] },
              ]
            : [{ name: "All files", extensions: ["*"] }],
      };
      const result = browserWindow
        ? await dialog.showOpenDialog(browserWindow, options)
        : await dialog.showOpenDialog(options);

      return result.canceled ? null : result.filePaths[0] ?? null;
    }
  );
  ipcMain.handle("native:sum", (_event, a: number, b: number) =>
    native.sum(a, b)
  );
};
