import { app, BrowserWindow, Menu, nativeImage, nativeTheme } from "electron";
import { APP_ICON_PATH, isMacOS } from "./constants";
import { initializeApplicationServices } from "./applicationServices";
import { createWindow } from "./mainWindow";
import { registerIpcHandlers } from "../ipc/registerIpcHandlers";
import { native, getRawNative } from "../native/nativeBridge";
import { installGuestViewErrorFilter } from "../utils/guestViewErrorFilter";

export const bootstrapApplication = (): void => {
  // Prevent multiple instances — must be called before app.whenReady().
  const gotTheLock = app.requestSingleInstanceLock();
  if (!gotTheLock) {
    app.quit();
    return;
  }

  app.on("second-instance", () => {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
      const win = windows[0];
      if (win.isMinimized()) {
        win.restore();
      }
      win.focus();
    }
  });

  // Install early, before any webview is created, so that expected
  // GUEST_VIEW_MANAGER_CALL navigation-abort errors are filtered from logs.
  installGuestViewErrorFilter();

  app.name = "Snow App";

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    nativeTheme.themeSource = "system";

    if (isMacOS && app.dock) {
      app.dock.setIcon(nativeImage.createFromPath(APP_ICON_PATH));
    }

    // Register IPC handlers and create the window immediately so the user
    // sees the UI without waiting for Rust SQLite initialisation. Native
    // method calls are auto-gated by the Proxy in nativeBridge.ts, which
    // awaits `storageReady` before forwarding any call.
    registerIpcHandlers(native);
    createWindow();

    // Initialise storage in the background — does not block window display.
    // Use the raw (un-proxied) binding to avoid deadlocking on storageReady.
    initializeApplicationServices(getRawNative()).catch((error) => {
      console.error("Failed to initialize application storage:", error);
    });

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
