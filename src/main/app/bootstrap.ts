import { app, BrowserWindow, Menu, nativeImage, nativeTheme } from "electron";
import { APP_ICON_PATH, isMacOS } from "./constants";
import { initializeApplicationServices } from "./applicationServices";
import { createWindow } from "./mainWindow";
import { registerIpcHandlers } from "../ipc/registerIpcHandlers";
import { native, getRawNative } from "../native/nativeBridge";
import { installGuestViewErrorFilter } from "../utils/guestViewErrorFilter";
import {
  registerThemeBgProtocol,
  registerThemeBgSchemePrivilege,
} from "./themeBgProtocol";

export const bootstrapApplication = (): void => {
  // registerSchemesAsPrivileged 必须在 app.whenReady() 之前调用，
  // 否则 Chromium 不会允许在 CSS url() / <img src> 中加载 theme-bg:// 资源。
  registerThemeBgSchemePrivilege();

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

    // 注册 theme-bg:// 自定义协议处理器，使渲染进程能加载本地背景图。
    // 必须在 createWindow 之前调用，确保窗口加载时协议已就绪。
    registerThemeBgProtocol();

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

    // Apply persisted theme mode to nativeTheme as soon as storage is ready.
    // This keeps the Electron window chrome (and shouldUseDarkColors) in sync
    // with the user's theme preference instead of always following the OS.
    getRawNative()
      .getThemeSettings()
      .then((settings) => {
        if (
          settings.mode === "light" ||
          settings.mode === "dark" ||
          settings.mode === "system"
        ) {
          nativeTheme.themeSource = settings.mode;
        }
      })
      .catch((error) => {
        console.warn("Failed to apply persisted theme mode:", error);
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
