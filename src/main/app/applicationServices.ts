import type { AppStorageInfo, NativeBridge } from "../native/types";
import { markStorageReady, markStorageFailed } from "./storageReady";
import { snowLog } from "../../utils/snowLogger";

const ensureDefaultWorkspaceDirectory = async (
  native: NativeBridge
): Promise<void> => {
  const directories = await native.listWorkspaceDirectories();

  if (directories.length === 0) {
    return;
  }

  if (!directories.some((directory) => directory.isActive)) {
    await native.activateWorkspaceDirectory(directories[0].directoryId);
  }
};

export const initializeApplicationServices = async (
  native: NativeBridge
): Promise<AppStorageInfo> => {
  try {
    const storageInfo = await native.initializeAppStorage();
    const cancelledSubAgentCount = await native.cancelRunningSubAgentSessions();
    await ensureDefaultWorkspaceDirectory(native);
    // 每次启动强制关闭请求日志，避免用户忘记手动关闭导致大量日志写入损伤硬盘。
    await native.setRequestLogging(false);
    await native.setRequestLoggingExpiry(0);
    if (cancelledSubAgentCount > 0) {
      console.info(
        `Cancelled ${cancelledSubAgentCount} interrupted sub-agent session(s)`
      );
      snowLog.warn({
        module: "app/storage",
        func: "initializeApplicationServices",
        message: "Cancelled interrupted sub-agent sessions from previous run",
        context: `count=${cancelledSubAgentCount}`,
      });
    }
    console.info("Snow App storage initialized:", storageInfo.databasePath);
    snowLog.info({
      module: "app/storage",
      func: "initializeApplicationServices",
      message: "Application storage initialized",
      context: storageInfo.databasePath,
    });
    markStorageReady();
    return storageInfo;
  } catch (error) {
    snowLog.error({
      module: "app/storage",
      func: "initializeApplicationServices",
      message: "Application storage initialization failed",
      error: error instanceof Error ? error.message : String(error),
    });
    markStorageFailed(error);
    throw error;
  }
};
