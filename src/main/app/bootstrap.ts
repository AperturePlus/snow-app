import { app, BrowserWindow, Menu, nativeImage, nativeTheme } from "electron";
import { APP_ICON_PATH, isMacOS } from "./constants";
import { initializeApplicationServices } from "./applicationServices";
import { createWindow } from "./mainWindow";
import { registerIpcHandlers } from "../ipc/registerIpcHandlers";
import { native, getRawNative } from "../native/nativeBridge";
import { installGuestViewErrorFilter } from "../utils/guestViewErrorFilter";
import { snowLog } from "../../utils/snowLogger";
import {
  registerThemeBgProtocol,
  registerThemeBgSchemePrivilege,
} from "./themeBgProtocol";
import {
  registerImageProxyProtocol,
  registerImageProxySchemePrivilege,
} from "./imageProxyProtocol";

export const bootstrapApplication = (): void => {
  snowLog.info({
    module: "app/bootstrap",
    func: "bootstrapApplication",
    message: "Application bootstrap started",
    context: `platform=${process.platform} electron=${process.versions.electron}`,
  });

  // registerSchemesAsPrivileged 必须在 app.whenReady() 之前调用，
  // 否则 Chromium 不会允许在 CSS url() / <img src> 中加载 theme-bg:// 资源。
  registerThemeBgSchemePrivilege();
  // img-proxy:// 同样需要在 whenReady 前声明特权，才能用于 <img src>。
  registerImageProxySchemePrivilege();

  // Prevent multiple instances — must be called before app.whenReady().
  const gotTheLock = app.requestSingleInstanceLock();
  if (!gotTheLock) {
    app.quit();
    return;
  }

  app.on("second-instance", () => {
    snowLog.info({
      module: "app/bootstrap",
      func: "second-instance",
      message: "Second instance detected, focusing existing window",
    });
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
    // 注册 img-proxy:// 协议处理器，代理渲染进程请求的外部 http(s) 图片，
    // 使 markdown 图片能绕过 CSP 限制安全加载。
    registerImageProxyProtocol();

    if (isMacOS && app.dock) {
      app.dock.setIcon(nativeImage.createFromPath(APP_ICON_PATH));
    }

    // Register IPC handlers and create the window immediately so the user
    // sees the UI without waiting for Rust SQLite initialisation. Native
    // method calls are auto-gated by the Proxy in nativeBridge.ts, which
    // awaits `storageReady` before forwarding any call.
    registerIpcHandlers(native);
    // createWindow 内部会异步读取持久化的窗口尺寸，此处无需等待。
    void createWindow();

    snowLog.info({
      module: "app/bootstrap",
      func: "whenReady",
      message: "Application ready, main window created",
    });

    // Initialise storage in the background — does not block window display.
    // Use the raw (un-proxied) binding to avoid deadlocking on storageReady.
    initializeApplicationServices(getRawNative()).catch((error) => {
      console.error("Failed to initialize application storage:", error);
      snowLog.error({
        module: "app/bootstrap",
        func: "initializeApplicationServices",
        message: "Failed to initialize application storage",
        error: error instanceof Error ? error.message : String(error),
      });
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
        snowLog.warn({
          module: "app/bootstrap",
          func: "applyThemeSettings",
          message: "Failed to apply persisted theme mode",
          error: error instanceof Error ? error.message : String(error),
        });
      });

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void createWindow();
      }
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      snowLog.info({
        module: "app/bootstrap",
        func: "window-all-closed",
        message: "All windows closed, quitting application",
      });
      app.quit();
    }
  });
};
