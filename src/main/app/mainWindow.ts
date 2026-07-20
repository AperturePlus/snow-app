import { BrowserWindow, nativeTheme, shell } from "electron";
import { is } from "@electron-toolkit/utils";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  APP_ICON_PATH,
  isMacOS,
  isWindows,
  macTrafficLightPosition,
} from "./constants";
import { killAllPtyForWebContents } from "../pty/ptyManager";

// 模块级关闭确认标志：渲染进程确认关闭后置为 true，使 close 事件不再被拦截。
// 这样可以统一覆盖所有关闭路径（自定义标题栏按钮、Alt+F4、任务栏关闭等）。
let closeConfirmed = false;

export const markCloseConfirmed = (): void => {
  closeConfirmed = true;
};

export const isCloseConfirmed = (): boolean => closeConfirmed;

const getWindowBackgroundColor = (): string =>
  nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#ffffff";

export const createWindow = (): void => {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: "Snow App",
    icon: APP_ICON_PATH,
    titleBarStyle: isMacOS ? "hidden" : "default",
    frame: isMacOS || isWindows ? false : true,
    ...(isMacOS ? { trafficLightPosition: macTrafficLightPosition } : {}),
    autoHideMenuBar: true,
    backgroundColor: getWindowBackgroundColor(),
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      spellcheck: false,
    },
  });

  mainWindow.setMenu(null);
  mainWindow.setMenuBarVisibility(false);
  mainWindow.setAutoHideMenuBar(true);

  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (is.dev && input.key === "F12") {
      event.preventDefault();
      mainWindow.webContents.toggleDevTools();
      return;
    }

    if (
      input.key === "Alt" ||
      input.code === "AltLeft" ||
      input.code === "AltRight"
    ) {
      event.preventDefault();
    }
  });

  nativeTheme.on("updated", () => {
    mainWindow.setBackgroundColor(getWindowBackgroundColor());
  });

  // Windows: 通知渲染进程窗口最大化状态变化（自定义标题栏需要同步图标）
  if (isWindows) {
    const notifyMaximizeState = (): void => {
      mainWindow.webContents.send(
        "window:maximize-state-changed",
        mainWindow.isMaximized()
      );
    };
    mainWindow.on("maximize", notifyMaximizeState);
    mainWindow.on("unmaximize", notifyMaximizeState);
  }

  // Clean up PTY sessions before window is fully destroyed.
  // 关闭二次确认仅适用于关闭即退出的平台（Windows/Linux）。
  // macOS 关闭按钮只是隐藏窗口，应用仍驻留程序坞，真正退出需 dock 右键退出
  // 或 Cmd+Q，不应弹出"退出确认"打断用户。
  if (!isMacOS) {
    mainWindow.on("close", (event) => {
      if (!isCloseConfirmed()) {
        event.preventDefault();
        mainWindow.webContents.send("window:close-requested");
        return;
      }
      killAllPtyForWebContents(mainWindow.webContents);
    });
  } else {
    // macOS: 关窗不退出，仍需清理 PTY 会话。
    mainWindow.on("close", () => {
      killAllPtyForWebContents(mainWindow.webContents);
    });
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch((error) => {
      console.error("Failed to open external URL:", error);
    });

    return { action: "deny" };
  });

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL).catch((error) => {
      console.error("Failed to load development renderer URL:", error);
    });
  } else {
    mainWindow
      .loadURL(
        pathToFileURL(join(__dirname, "../renderer/index.html")).toString()
      )
      .catch((error) => {
        console.error("Failed to load packaged renderer:", error);
      });
  }
};
