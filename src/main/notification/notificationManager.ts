import { app, BrowserWindow, Notification } from "electron";
import { APP_ICON_PATH } from "../app/constants";

export type AppNotificationOptions = {
  title: string;
  body: string;
  silent?: boolean;
};

/**
 * 跨平台系统通知模块。
 *
 * Electron 的 Notification API 本身已封装平台差异：
 * - macOS: 原生通知中心 (Notification Center)
 * - Windows: Toast 通知
 * - Linux: libnotify / freedesktop.org 通知规范
 *
 * 本模块在此基础上增加：
 * 1. 窗口聚焦检测 — 用户正在看应用时不弹通知，避免打扰
 * 2. 不支持通知时的 fallback — 闪烁任务栏 (Windows) / Dock bounce (macOS)
 * 3. 通知点击后聚焦窗口
 */

const isAnyWindowFocused = (): boolean =>
  BrowserWindow.getAllWindows().some(
    (win) => !win.isDestroyed() && win.isVisible() && win.isFocused()
  );

const flashTaskbar = (): void => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isFocused() || win.isDestroyed()) {
      continue;
    }
    win.flashFrame(true);
    // 窗口获得焦点后停止闪烁
    const stopFlash = (): void => {
      win.flashFrame(false);
      win.removeListener("focus", stopFlash);
    };
    win.once("focus", stopFlash);
  }
};

const bounceDock = (): void => {
  if (process.platform === "darwin" && app.dock) {
    app.dock.bounce("informational");
  }
};

const focusMainWindow = (): void => {
  const windows = BrowserWindow.getAllWindows();
  if (windows.length === 0) {
    return;
  }
  const win = windows[0];
  if (win.isMinimized()) {
    win.restore();
  }
  win.focus();
};

export const showAppNotification = (options: AppNotificationOptions): void => {
  // 窗口已聚焦时用户能直接看到 UI，不需要系统通知
  if (isAnyWindowFocused()) {
    return;
  }

  // 不支持系统通知时的降级方案：仅闪烁任务栏 / bounce dock
  if (!Notification.isSupported()) {
    flashTaskbar();
    bounceDock();
    return;
  }

  const notification = new Notification({
    title: options.title,
    body: options.body,
    icon: APP_ICON_PATH,
    silent: options.silent ?? false,
  });

  notification.on("click", () => {
    focusMainWindow();
  });

  notification.show();

  // 额外的注意力信号
  flashTaskbar();
  bounceDock();
};
