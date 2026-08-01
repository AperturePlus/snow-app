import { ipcRenderer } from "electron";
import type {
  FileContentResult,
  FileSearchResult,
  ParsedSshUrl,
  RemoteWorkspaceFileSearchOptions,
  SshConnectParams,
  SshCredentialRecord,
  SshDirectoryEntry,
  SshAuthMethod,
} from "../types";

export const sshApi = {
  sshConnect: (params: SshConnectParams): Promise<string> =>
    ipcRenderer.invoke("ssh:connect", params),
  sshListDirectory: (
    sessionId: string,
    remotePath: string
  ): Promise<SshDirectoryEntry[]> =>
    ipcRenderer.invoke("ssh:list-directory", sessionId, remotePath),
  sshExecuteCommand: (sessionId: string, command: string): Promise<string> =>
    ipcRenderer.invoke("ssh:execute-command", sessionId, command),
  searchRemoteWorkspaceFiles: (
    workspacePath: string,
    options: RemoteWorkspaceFileSearchOptions
  ): Promise<FileSearchResult[]> =>
    ipcRenderer.invoke("ssh:search-workspace-files", workspacePath, options),
  sshReadFile: (
    sessionId: string,
    remotePath: string
  ): Promise<FileContentResult> =>
    ipcRenderer.invoke("ssh:read-file", sessionId, remotePath),
  sshWriteFile: (
    sessionId: string,
    remotePath: string,
    content: string
  ): Promise<void> =>
    ipcRenderer.invoke("ssh:write-file", sessionId, remotePath, content),
  sshDeleteEntry: (sessionId: string, remotePath: string): Promise<void> =>
    ipcRenderer.invoke("ssh:delete-entry", sessionId, remotePath),
  sshRenameEntry: (
    sessionId: string,
    remotePath: string,
    newName: string
  ): Promise<void> =>
    ipcRenderer.invoke("ssh:rename-entry", sessionId, remotePath, newName),
  sshDisconnect: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke("ssh:disconnect", sessionId),
  sshSaveCredential: (params: {
    host: string;
    port: number;
    username: string;
    authMethod: SshAuthMethod;
    privateKeyPath?: string;
    secret?: string;
  }): Promise<SshCredentialRecord> =>
    ipcRenderer.invoke("ssh:save-credential", params),
  sshGetCredential: (
    host: string,
    port: number,
    username: string
  ): Promise<SshCredentialRecord | null> =>
    ipcRenderer.invoke("ssh:get-credential", host, port, username),
  sshGetDecryptedSecret: (
    host: string,
    port: number,
    username: string
  ): Promise<string | null> =>
    ipcRenderer.invoke("ssh:get-decrypted-secret", host, port, username),
  sshListCredentials: (): Promise<SshCredentialRecord[]> =>
    ipcRenderer.invoke("ssh:list-credentials"),
  sshDeleteCredential: (
    host: string,
    port: number,
    username: string
  ): Promise<void> =>
    ipcRenderer.invoke("ssh:delete-credential", host, port, username),
  sshSelectPrivateKey: (dialogTitle?: string): Promise<string | null> =>
    ipcRenderer.invoke("ssh:select-private-key", dialogTitle),
  sshParseUrl: (sshUrl: string): Promise<ParsedSshUrl> =>
    ipcRenderer.invoke("ssh:parse-url", sshUrl),
};
