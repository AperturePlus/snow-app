import { app, ipcMain, BrowserWindow } from "electron";
import electronUpdater from "electron-updater";
import { snowLog } from "../../utils/snowLogger";

const { autoUpdater } = electronUpdater;

const UPDATE_CHANNEL = "updater:status-changed";

export interface UpdateStatus {
  available: boolean;
  version: string | null;
  downloading: boolean;
  progress: number;
  downloaded: boolean;
  error: string | null;
}

let status: UpdateStatus = {
  available: false,
  version: null,
  downloading: false,
  progress: 0,
  downloaded: false,
  error: null,
};

let initialized = false;
let mainWindowRef: BrowserWindow | null = null;

// 运行时定时检查间隔（毫秒），默认 1 小时
const RUNTIME_CHECK_INTERVAL_MS = 60 * 60 * 1000;
let runtimeCheckTimer: NodeJS.Timeout | null = null;

const broadcastStatus = (): void => {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send(UPDATE_CHANNEL, status);
  }
};

const setStatus = (partial: Partial<UpdateStatus>): void => {
  status = { ...status, ...partial };
  broadcastStatus();
};

export const getUpdateStatus = (): UpdateStatus => status;

// 执行一次更新检查，统一处理错误日志
const checkForUpdatesAction = async (): Promise<UpdateStatus> => {
  try {
    await autoUpdater.checkForUpdates();
    return getUpdateStatus();
  } catch (error) {
    snowLog.error({
      module: "updater",
      func: "checkForUpdatesAction",
      message: "Check for updates failed",
      error: error instanceof Error ? error.message : String(error),
    });
    setStatus({
      error: error instanceof Error ? error.message : String(error),
    });
    return getUpdateStatus();
  }
};

export const initAutoUpdater = (mainWindow: BrowserWindow): void => {
  if (initialized) {
    mainWindowRef = mainWindow;
    return;
  }
  initialized = true;
  mainWindowRef = mainWindow;

  // 不自动下载，由用户点击按钮触发
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.requestHeaders = {};

  autoUpdater.on("checking-for-update", () => {
    snowLog.info({
      module: "updater",
      func: "checking-for-update",
      message: "Checking for updates...",
    });
  });

  autoUpdater.on("update-available", (info) => {
    snowLog.info({
      module: "updater",
      func: "update-available",
      message: `Update available: ${info.version}`,
    });
    setStatus({
      available: true,
      version: info.version,
      downloading: false,
      downloaded: false,
      error: null,
    });
  });

  autoUpdater.on("update-not-available", (info) => {
    snowLog.info({
      module: "updater",
      func: "update-not-available",
      message: `No update available, current: ${info.version}`,
    });
    setStatus({
      available: false,
      version: null,
      downloading: false,
      progress: 0,
      downloaded: false,
      error: null,
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    setStatus({
      progress: Math.round(progress.percent),
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    snowLog.info({
      module: "updater",
      func: "update-downloaded",
      message: `Update downloaded: ${info.version}`,
    });
    setStatus({
      downloading: false,
      progress: 100,
      downloaded: true,
    });
  });

  autoUpdater.on("error", (error) => {
    snowLog.error({
      module: "updater",
      func: "error",
      message: "Update error",
      error: error instanceof Error ? error.message : String(error),
    });
    setStatus({
      downloading: false,
      downloaded: false,
      error: error instanceof Error ? error.message : String(error),
    });
  });

  // 启动时异步检查更新（dev 与打包环境均检查）
  if (!app.isPackaged) {
    autoUpdater.forceDevUpdateConfig = true;
  }
  setTimeout(() => {
    void checkForUpdatesAction();
  }, 3000);

  // 运行时定时检查：应用长时间运行时周期性探测新版本
  // 仅在无可用更新、未在下载、未下载完成时才执行实际检查，避免重复打扰
  runtimeCheckTimer = setInterval(() => {
    if (
      status.available ||
      status.downloading ||
      status.downloaded
    ) {
      return;
    }
    void checkForUpdatesAction();
  }, RUNTIME_CHECK_INTERVAL_MS);

  // 用户点击"立即更新" → 开始下载
  ipcMain.handle("updater:download-update", async () => {
    try {
      setStatus({ downloading: true, progress: 0, error: null });
      await autoUpdater.downloadUpdate();
      return getUpdateStatus();
    } catch (error) {
      snowLog.error({
        module: "updater",
        func: "download-update",
        message: "Failed to download update",
        error: error instanceof Error ? error.message : String(error),
      });
      setStatus({
        downloading: false,
        error: error instanceof Error ? error.message : String(error),
      });
      return getUpdateStatus();
    }
  });

  // 用户点击"重启更新" → 退出并安装
  ipcMain.handle("updater:install-update", () => {
    autoUpdater.quitAndInstall();
  });

  ipcMain.handle("updater:get-status", () => getUpdateStatus());

  // 用户手动触发检查更新
  ipcMain.handle("updater:check-for-updates", () => checkForUpdatesAction());

  ipcMain.handle("app:get-version", () => app.getVersion());

  // 应用退出时清理运行时定时检查
  app.on("before-quit", () => {
    if (runtimeCheckTimer) {
      clearInterval(runtimeCheckTimer);
      runtimeCheckTimer = null;
    }
  });
};
