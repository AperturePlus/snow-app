import { app } from "electron";
import type { AppStorageInfo, NativeBridge } from "../native/types";
import { createWorkspaceDirectoryInput } from "../settings/workspaceDirectories";

const ensureDefaultWorkspaceDirectory = async (
  native: NativeBridge
): Promise<void> => {
  const directories = await native.listWorkspaceDirectories();

  if (directories.length === 0) {
    await native.upsertWorkspaceDirectory(
      createWorkspaceDirectoryInput(app.getPath("home"), "local", 0)
    );
    return;
  }

  if (!directories.some((directory) => directory.isActive)) {
    await native.activateWorkspaceDirectory(directories[0].directoryId);
  }
};

export const initializeApplicationServices = async (
  native: NativeBridge
): Promise<AppStorageInfo> => {
  const storageInfo = await native.initializeAppStorage();
  await ensureDefaultWorkspaceDirectory(native);
  console.info("Snow App storage initialized:", storageInfo.databasePath);
  return storageInfo;
};
