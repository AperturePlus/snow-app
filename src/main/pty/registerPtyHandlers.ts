import { ipcMain, type IpcMainInvokeEvent } from "electron";
import {
  createPtySession,
  killPty,
  resizePty,
  writePtyInput,
  type PtySessionOptions,
} from "./ptyManager";

const normalizePtySessionOptions = (
  value: unknown
): PtySessionOptions => {
  if (typeof value !== "object" || value === null) {
    throw new Error("Invalid PTY session options");
  }
  const obj = value as Record<string, unknown>;
  const cwd = typeof obj.cwd === "string" ? obj.cwd : process.cwd();
  const cols = typeof obj.cols === "number" ? obj.cols : 80;
  const rows = typeof obj.rows === "number" ? obj.rows : 24;
  return { cwd, cols, rows };
};

export const registerPtyHandlers = (): void => {
  ipcMain.handle("pty:create", (event: IpcMainInvokeEvent, options: unknown) => {
    const opts = normalizePtySessionOptions(options);
    return createPtySession(event.sender, opts);
  });

  ipcMain.handle(
    "pty:write",
    (event: IpcMainInvokeEvent, id: unknown, data: unknown) => {
      if (typeof id !== "string" || typeof data !== "string") {
        throw new Error("Invalid PTY write arguments");
      }
      writePtyInput(id, data);
      return undefined;
    }
  );

  ipcMain.handle(
    "pty:resize",
    (
      event: IpcMainInvokeEvent,
      id: unknown,
      cols: unknown,
      rows: unknown
    ) => {
      if (
        typeof id !== "string" ||
        typeof cols !== "number" ||
        typeof rows !== "number"
      ) {
        throw new Error("Invalid PTY resize arguments");
      }
      resizePty(id, cols, rows);
      return undefined;
    }
  );

  ipcMain.handle("pty:kill", (event: IpcMainInvokeEvent, id: unknown) => {
    if (typeof id !== "string") {
      throw new Error("Invalid PTY kill argument");
    }
    killPty(id);
    return undefined;
  });
};
