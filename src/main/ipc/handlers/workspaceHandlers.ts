import { BrowserWindow, dialog, ipcMain } from "electron";
import { promises as fs } from "fs";
import type { NativeBridge } from "../../native/types";
import {
  normalizeWorkspaceDirectory,
  normalizeWorkspaceDirectoryList,
} from "../../settings/workspaceDirectories";
import { startDirectoryWatch, stopDirectoryWatch } from "../../utils/fsWatcher";

export const registerWorkspaceHandlers = (native: NativeBridge): void => {
  ipcMain.handle("workspace-directories:list", () =>
    native.listWorkspaceDirectories()
  );
  ipcMain.handle(
    "workspace-directories:upsert",
    async (_event, item: unknown) => {
      const existingCount = (await native.listWorkspaceDirectories()).length;
      await native.upsertWorkspaceDirectory(
        normalizeWorkspaceDirectory(item, existingCount)
      );
      return native.listWorkspaceDirectories();
    }
  );
  ipcMain.handle(
    "workspace-directories:activate",
    async (_event, directoryId: unknown) => {
      if (typeof directoryId !== "string" || !directoryId.trim()) {
        throw new Error("Workspace directory ID is required");
      }

      await native.activateWorkspaceDirectory(directoryId.trim());
      return native.listWorkspaceDirectories();
    }
  );
  ipcMain.handle(
    "workspace-directories:reorder",
    async (_event, items: unknown) => {
      const existingCount = (await native.listWorkspaceDirectories()).length;
      const directories = normalizeWorkspaceDirectoryList(items, existingCount);

      if (typeof native.reorderWorkspaceDirectories === "function") {
        await native.reorderWorkspaceDirectories(directories);
      } else {
        for (const directory of directories) {
          await native.upsertWorkspaceDirectory(directory);
        }
      }

      return native.listWorkspaceDirectories();
    }
  );
  ipcMain.handle(
    "workspace-directories:delete",
    async (_event, directoryId: unknown) => {
      if (typeof directoryId !== "string" || !directoryId.trim()) {
        throw new Error("Workspace directory ID is required");
      }

      await native.deleteWorkspaceDirectory(directoryId.trim());
      return native.listWorkspaceDirectories();
    }
  );
  ipcMain.handle(
    "workspace-directories:select-local-directory",
    async (event, dialogTitle: unknown) => {
      const browserWindow = BrowserWindow.fromWebContents(event.sender);
      const title =
        typeof dialogTitle === "string" && dialogTitle.trim()
          ? dialogTitle.trim()
          : "Select workspace directory";
      const options: Electron.OpenDialogOptions = {
        title,
        properties: ["openDirectory"],
      };
      const result = browserWindow
        ? await dialog.showOpenDialog(browserWindow, options)
        : await dialog.showOpenDialog(options);

      return result.canceled ? null : result.filePaths[0] ?? null;
    }
  );

  // ===== Directory entries / watch / search =====
  ipcMain.handle(
    "workspace-directories:read-entries",
    (_event, dirPath: unknown) => {
      if (typeof dirPath !== "string" || !dirPath.trim()) {
        throw new Error("Directory path is required");
      }

      return native.readDirectoryEntries(dirPath.trim());
    }
  );

  ipcMain.handle(
    "workspace-directories:read-file",
    (_event, filePath: unknown) => {
      if (typeof filePath !== "string" || !filePath.trim()) {
        throw new Error("File path is required");
      }
      return native.readFileContent(filePath.trim());
    }
  );

  ipcMain.handle(
    "workspace-directories:start-watch",
    (_event, dirPath: unknown) => {
      if (typeof dirPath !== "string" || !dirPath.trim()) {
        throw new Error("Directory path is required");
      }

      startDirectoryWatch(dirPath.trim());
    }
  );

  ipcMain.handle(
    "workspace-directories:stop-watch",
    (_event, dirPath: unknown) => {
      if (typeof dirPath !== "string" || !dirPath.trim()) {
        throw new Error("Directory path is required");
      }

      stopDirectoryWatch(dirPath.trim());
    }
  );

  ipcMain.handle(
    "workspace-directories:search-files",
    (_event, dirPath: unknown, query: unknown) => {
      if (typeof dirPath !== "string" || !dirPath.trim()) {
        throw new Error("Directory path is required");
      }
      if (typeof query !== "string" || !query.trim()) {
        return [];
      }

      return native.searchFiles(dirPath.trim(), query.trim());
    }
  );

  // ===== File picker dialog (multi-select) =====
  ipcMain.handle(
    "workspace-directories:select-files",
    async (event, dialogTitle: unknown) => {
      const browserWindow = BrowserWindow.fromWebContents(event.sender);
      const title =
        typeof dialogTitle === "string" && dialogTitle.trim()
          ? dialogTitle.trim()
          : "Select files and folders";
      const options: Electron.OpenDialogOptions = {
        title,
        properties: ["openFile", "openDirectory", "multiSelections"],
      };
      const result = browserWindow
        ? await dialog.showOpenDialog(browserWindow, options)
        : await dialog.showOpenDialog(options);

      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }

      const entries = await Promise.all(
        result.filePaths.map(async (path) => {
          try {
            const stat = await fs.stat(path);
            return { path, isDirectory: stat.isDirectory() };
          } catch {
            return { path, isDirectory: false };
          }
        })
      );

      return entries;
    }
  );

  // ===== Dialog handlers (browser executable, terminal executable) =====
  ipcMain.handle(
    "proxy-browser-settings:select-browser-executable",
    async (event, dialogTitle: unknown) => {
      const browserWindow = BrowserWindow.fromWebContents(event.sender);
      const title =
        typeof dialogTitle === "string" && dialogTitle.trim()
          ? dialogTitle.trim()
          : "Select browser executable";
      const options: Electron.OpenDialogOptions = {
        title,
        properties: ["openFile"],
        filters:
          process.platform === "win32"
            ? [
                { name: "Applications", extensions: ["exe"] },
                { name: "All files", extensions: ["*"] },
              ]
            : [{ name: "All files", extensions: ["*"] }],
      };
      const result = browserWindow
        ? await dialog.showOpenDialog(browserWindow, options)
        : await dialog.showOpenDialog(options);

      return result.canceled ? null : result.filePaths[0] ?? null;
    }
  );
  ipcMain.handle(
    "terminal-settings:select-executable",
    async (event, dialogTitle: unknown) => {
      const browserWindow = BrowserWindow.fromWebContents(event.sender);
      const title =
        typeof dialogTitle === "string" && dialogTitle.trim()
          ? dialogTitle.trim()
          : "Select terminal executable";
      const options: Electron.OpenDialogOptions = {
        title,
        properties: ["openFile"],
        filters:
          process.platform === "win32"
            ? [
                { name: "Applications", extensions: ["exe", "bat", "cmd"] },
                { name: "All files", extensions: ["*"] },
              ]
            : [{ name: "All files", extensions: ["*"] }],
      };
      const result = browserWindow
        ? await dialog.showOpenDialog(browserWindow, options)
        : await dialog.showOpenDialog(options);

      return result.canceled ? null : result.filePaths[0] ?? null;
    }
  );
};
