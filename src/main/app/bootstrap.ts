import { app, BrowserWindow, Menu, nativeImage, nativeTheme } from "electron";
import { APP_ICON_PATH, isMacOS } from "./constants";
import { initializeApplicationServices } from "./applicationServices";
import { createWindow } from "./mainWindow";
import { registerIpcHandlers } from "../ipc/registerIpcHandlers";
import { native } from "../native/nativeBridge";

export const bootstrapApplication = (): void => {
  app.name = "Snow App";

  app.whenReady().then(() => {
    initializeApplicationServices(native);

    Menu.setApplicationMenu(null);
    nativeTheme.themeSource = "system";

    if (isMacOS && app.dock) {
      app.dock.setIcon(nativeImage.createFromPath(APP_ICON_PATH));
    }

    registerIpcHandlers(native);
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
};
