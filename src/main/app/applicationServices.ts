import { app } from "electron";
import type { AppStorageInfo, NativeBridge } from "../native/types";
import { createWorkspaceDirectoryInput } from "../settings/workspaceDirectories";

const ensureDefaultWorkspaceDirectory = (native: NativeBridge): void => {
  const directories = native.listWorkspaceDirectories();

  if (directories.length === 0) {
    native.upsertWorkspaceDirectory(
      createWorkspaceDirectoryInput(app.getPath("home"), "local", 0)
    );
    return;
  }

  if (!directories.some((directory) => directory.isActive)) {
    native.activateWorkspaceDirectory(directories[0].directoryId);
  }
};

export const initializeApplicationServices = (
  native: NativeBridge
): AppStorageInfo => {
  const storageInfo = native.initializeAppStorage();
  ensureDefaultWorkspaceDirectory(native);
  console.info("Snow App storage initialized:", storageInfo.databasePath);
  return storageInfo;
};
