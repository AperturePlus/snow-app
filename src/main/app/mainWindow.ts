import { BrowserWindow, nativeTheme, shell } from "electron";
import { is } from "@electron-toolkit/utils";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { APP_ICON_PATH, isMacOS, macTrafficLightPosition } from "./constants";

const getWindowBackgroundColor = (): string =>
  nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#ffffff";

export const createWindow = (): void => {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: "Snow App",
    icon: APP_ICON_PATH,
    titleBarStyle: isMacOS ? "hidden" : "default",
    ...(isMacOS ? { trafficLightPosition: macTrafficLightPosition } : {}),
    autoHideMenuBar: true,
    backgroundColor: getWindowBackgroundColor(),
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
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

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

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
