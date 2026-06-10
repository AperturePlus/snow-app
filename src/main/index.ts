import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, ipcMain, shell } from "electron";
import { is } from "@electron-toolkit/utils";

type NativeBridge = {
  engineInfo: () => string;
  sum: (a: number, b: number) => number;
};

const loadNativeBridge = (): NativeBridge => {
  try {
    const nativeEntry = join(app.getAppPath(), "native", "index.cjs");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(nativeEntry) as NativeBridge;
  } catch (error) {
    console.warn(
      "Native Rust bridge is unavailable, using development fallback.",
      error
    );

    return {
      engineInfo: () => "Rust native bridge is not built yet",
      sum: (a: number, b: number) => a + b,
    };
  }
};

const native = loadNativeBridge();

const createWindow = (): void => {
  const mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: "Snow App",
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 14, y: 13 },
    backgroundColor: "#0f172a",
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
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

app.whenReady().then(() => {
  ipcMain.handle("native:engine-info", () => native.engineInfo());
  ipcMain.handle("native:sum", (_event, a: number, b: number) =>
    native.sum(a, b)
  );

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
