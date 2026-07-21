import { BrowserWindow, dialog, ipcMain } from "electron";
import { homedir } from "node:os";
import type { NativeBridge } from "../../native/types";
import {
  connectSsh,
  disconnectSsh,
  listSshDirectory,
  parseSshUrl,
  isSshPath,
  readSshFile,
  writeSshFile,
  type SshConnectParams,
} from "../../ssh/sshManager";
import { processFileContent } from "../../utils/fileReader";
import {
  saveSshCredentialWithPlainSecret,
  getSshCredential,
  getDecryptedSecret,
  listSshCredentials,
  deleteSshCredential,
} from "../../ssh/sshCredentials";

export const registerSshHandlers = (_native: NativeBridge): void => {
  const normalizeSshConnectParams = (value: unknown): SshConnectParams => {
    if (typeof value !== "object" || value === null) {
      throw new Error("SSH connect params must be an object");
    }
    const obj = value as Record<string, unknown>;
    const host = typeof obj.host === "string" ? obj.host.trim() : "";
    const port = typeof obj.port === "number" ? obj.port : 22;
    const username =
      typeof obj.username === "string" ? obj.username.trim() : "";
    const authMethod =
      obj.authMethod === "password" ||
      obj.authMethod === "privateKey" ||
      obj.authMethod === "agent"
        ? (obj.authMethod as SshConnectParams["authMethod"])
        : "password";

    if (!host) {
      throw new Error("SSH host is required");
    }
    if (!username) {
      throw new Error("SSH username is required");
    }

    const result: SshConnectParams = { host, port, username, authMethod };
    if (typeof obj.password === "string" && obj.password) {
      result.password = obj.password;
    }
    if (typeof obj.privateKeyPath === "string" && obj.privateKeyPath) {
      result.privateKeyPath = obj.privateKeyPath;
    }
    if (typeof obj.passphrase === "string" && obj.passphrase) {
      result.passphrase = obj.passphrase;
    }
    return result;
  };

  ipcMain.handle("ssh:connect", async (_event, params: unknown) => {
    const connectParams = normalizeSshConnectParams(params);
    return connectSsh(connectParams);
  });

  ipcMain.handle(
    "ssh:list-directory",
    async (_event, sessionId: unknown, remotePath: unknown) => {
      if (typeof sessionId !== "string" || !sessionId.trim()) {
        throw new Error("SSH session ID is required");
      }
      if (typeof remotePath !== "string" || !remotePath.trim()) {
        throw new Error("Remote directory path is required");
      }
      return listSshDirectory(sessionId.trim(), remotePath.trim());
    }
  );

  ipcMain.handle(
    "ssh:read-file",
    async (_event, sessionId: unknown, remotePath: unknown) => {
      if (typeof sessionId !== "string" || !sessionId.trim()) {
        throw new Error("SSH session ID is required");
      }
      if (typeof remotePath !== "string" || !remotePath.trim()) {
        throw new Error("Remote file path is required");
      }
      const buffer = await readSshFile(sessionId.trim(), remotePath.trim());
      return processFileContent(remotePath.trim(), buffer);
    }
  );

  ipcMain.handle(
    "ssh:write-file",
    async (
      _event,
      sessionId: unknown,
      remotePath: unknown,
      content: unknown
    ) => {
      if (typeof sessionId !== "string" || !sessionId.trim()) {
        throw new Error("SSH session ID is required");
      }
      if (typeof remotePath !== "string" || !remotePath.trim()) {
        throw new Error("Remote file path is required");
      }
      if (typeof content !== "string") {
        throw new Error("File content must be a string");
      }
      return writeSshFile(sessionId.trim(), remotePath.trim(), content);
    }
  );

  ipcMain.handle("ssh:disconnect", (_event, sessionId: unknown) => {
    if (typeof sessionId !== "string") {
      return;
    }
    disconnectSsh(sessionId);
  });

  ipcMain.handle("ssh:save-credential", (_event, params: unknown) => {
    if (typeof params !== "object" || params === null) {
      throw new Error("SSH credential params must be an object");
    }
    const obj = params as Record<string, unknown>;
    const host = typeof obj.host === "string" ? obj.host.trim() : "";
    const port = typeof obj.port === "number" ? obj.port : 22;
    const username =
      typeof obj.username === "string" ? obj.username.trim() : "";
    const authMethod =
      obj.authMethod === "password" ||
      obj.authMethod === "privateKey" ||
      obj.authMethod === "agent"
        ? (obj.authMethod as SshConnectParams["authMethod"])
        : "password";

    if (!host || !username) {
      throw new Error("SSH host and username are required");
    }

    return saveSshCredentialWithPlainSecret({
      host,
      port,
      username,
      authMethod,
      privateKeyPath:
        typeof obj.privateKeyPath === "string" ? obj.privateKeyPath : undefined,
      secret: typeof obj.secret === "string" ? obj.secret : undefined,
    });
  });

  ipcMain.handle(
    "ssh:get-credential",
    (_event, host: unknown, port: unknown, username: unknown) => {
      if (typeof host !== "string" || typeof username !== "string") {
        return null;
      }
      const portNum = typeof port === "number" ? port : 22;
      return getSshCredential(host.trim(), portNum, username.trim());
    }
  );

  ipcMain.handle(
    "ssh:get-decrypted-secret",
    (_event, host: unknown, port: unknown, username: unknown) => {
      if (typeof host !== "string" || typeof username !== "string") {
        return null;
      }
      const portNum = typeof port === "number" ? port : 22;
      return getDecryptedSecret(host.trim(), portNum, username.trim());
    }
  );

  ipcMain.handle("ssh:list-credentials", () => listSshCredentials());

  ipcMain.handle(
    "ssh:delete-credential",
    (_event, host: unknown, port: unknown, username: unknown) => {
      if (typeof host !== "string" || typeof username !== "string") {
        return;
      }
      const portNum = typeof port === "number" ? port : 22;
      deleteSshCredential(host.trim(), portNum, username.trim());
    }
  );

  ipcMain.handle(
    "ssh:select-private-key",
    async (event, dialogTitle: unknown) => {
      const browserWindow = BrowserWindow.fromWebContents(event.sender);
      const title =
        typeof dialogTitle === "string" && dialogTitle.trim()
          ? dialogTitle.trim()
          : "Select private key file";
      const homeDir = homedir();
      const options: Electron.OpenDialogOptions = {
        title,
        properties: ["openFile"],
        defaultPath: `${homeDir}/.ssh`,
      };
      const result = browserWindow
        ? await dialog.showOpenDialog(browserWindow, options)
        : await dialog.showOpenDialog(options);
      return result.canceled ? null : result.filePaths[0] ?? null;
    }
  );

  ipcMain.handle("ssh:parse-url", (_event, sshUrl: unknown) => {
    if (typeof sshUrl !== "string" || !sshUrl.trim()) {
      throw new Error("SSH URL is required");
    }
    if (!isSshPath(sshUrl.trim())) {
      throw new Error("Path is not an SSH URL");
    }
    return parseSshUrl(sshUrl.trim());
  });
};
