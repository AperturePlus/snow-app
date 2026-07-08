import { ipcRenderer } from "electron";
import type {
  FileContentResult,
  ParsedSshUrl,
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
  sshReadFile: (
    sessionId: string,
    remotePath: string
  ): Promise<FileContentResult> =>
    ipcRenderer.invoke("ssh:read-file", sessionId, remotePath),
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
