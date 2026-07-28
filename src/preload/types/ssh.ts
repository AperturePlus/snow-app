export type SshAuthMethod = "password" | "privateKey" | "agent";

export type SshConnectParams = {
  host: string;
  port: number;
  username: string;
  authMethod: SshAuthMethod;
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
};

export type SshDirectoryEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
};

export type RemoteWorkspaceFileSearchOptions = {
  query: string;
  listChildren: boolean;
};

export type SshCredentialRecord = {
  profileKey: string;
  host: string;
  port: number;
  username: string;
  authMethod: SshAuthMethod;
  privateKeyPath?: string;
  encryptedSecret?: string;
};

export type ParsedSshUrl = {
  host: string;
  port: number;
  username: string;
  remotePath: string;
};
