import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  nativeImage,
  screen,
  session,
} from "electron";
import type { NativeBridge } from "../../native/types";
import { markCloseConfirmed } from "../../app/mainWindow";
import { clearWindowState } from "../../app/windowState";

export const registerWindowHandlers = (_native: NativeBridge): void => {
  // ===== Window Controls (Windows custom titlebar) =====
  ipcMain.handle("window:minimize", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.handle("window:maximize-toggle", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      return;
    }
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  });

  // 渲染进程触发关闭：与原生关闭路径一致，走 close 事件拦截流程。
  // mainWindow.ts 的 close 监听会 preventDefault 并回推 window:close-requested。
  ipcMain.handle("window:close", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  // 渲染进程用户确认关闭后调用：标记已确认，直接退出整个应用进程。
  // 所有平台统一使用 app.quit() 彻底退出，macOS 不再驻留 dock。
  ipcMain.handle("window:confirm-close", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      return;
    }
    markCloseConfirmed();
    app.quit();
  });

  ipcMain.handle("window:is-maximized", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win ? win.isMaximized() : false;
  });

  // 清除持久化的窗口尺寸/位置缓存（主题重置时一并调用），
  // 下次启动回退到默认窗口尺寸。
  ipcMain.handle("window:clear-state", async () => {
    await clearWindowState();
  });

  // ===== Window Drag (macOS JS drag region) =====
  let dragInterval: NodeJS.Timeout | null = null;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  ipcMain.handle("window:start-drag", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      return;
    }
    if (dragInterval) {
      clearInterval(dragInterval);
    }
    const winBounds = win.getBounds();
    const cursor = screen.getCursorScreenPoint();
    dragOffsetX = cursor.x - winBounds.x;
    dragOffsetY = cursor.y - winBounds.y;
    dragInterval = setInterval(() => {
      if (!win || win.isDestroyed()) {
        if (dragInterval) {
          clearInterval(dragInterval);
          dragInterval = null;
        }
        return;
      }
      const cur = screen.getCursorScreenPoint();
      win.setBounds({
        x: cur.x - dragOffsetX,
        y: cur.y - dragOffsetY,
        width: winBounds.width,
        height: winBounds.height,
      });
    }, 16);
  });

  ipcMain.handle("window:stop-drag", () => {
    if (dragInterval) {
      clearInterval(dragInterval);
      dragInterval = null;
    }
  });

  // ===== Clipboard (write image) =====
  ipcMain.handle("clipboard:write-image", (_event, dataUrl: unknown) => {
    if (typeof dataUrl !== "string" || !dataUrl.trim()) {
      throw new Error("Image data URL is required");
    }

    const image = nativeImage.createFromDataURL(dataUrl);
    if (image.isEmpty()) {
      throw new Error("Failed to create image from data URL");
    }

    clipboard.writeImage(image);
  });

  // ===== Browser (embedded webview) =====
  ipcMain.handle("browser:clear-cache", async () => {
    await session.defaultSession.clearCache();
  });

  ipcMain.handle("browser:clear-cookies", async () => {
    await session.defaultSession.clearStorageData({ storages: ["cookies"] });
  });
};
