import { app, safeStorage } from "electron";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { SshAuthMethod } from "./sshManager";
import { getSshProfileKey } from "./sshManager";

export type SshCredentialRecord = {
  profileKey: string;
  host: string;
  port: number;
  username: string;
  authMethod: SshAuthMethod;
  privateKeyPath?: string;
  encryptedSecret?: string;
};

const getCredentialsDir = (): string =>
  join(app.getPath("userData"), "ssh-credentials");

const getCredentialsFilePath = (): string =>
  join(getCredentialsDir(), "credentials.json");

type StoredCredentialRecord = {
  profileKey: string;
  host: string;
  port: number;
  username: string;
  authMethod: SshAuthMethod;
  privateKeyPath?: string;
  encryptedSecret?: string;
};

const ensureCredentialsDir = (): void => {
  const dir = getCredentialsDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  } else {
    // Ensure existing directory has restricted permissions
    try {
      chmodSync(dir, 0o700);
    } catch {
      // chmod can fail on some platforms; ignore
    }
  }
};

const readAllCredentials = (): StoredCredentialRecord[] => {
  ensureCredentialsDir();
  const filePath = getCredentialsFilePath();
  if (!existsSync(filePath)) {
    return [];
  }
  try {
    const content = readFileSync(filePath, "utf-8");
    const data = JSON.parse(content);
    if (!Array.isArray(data)) {
      return [];
    }
    return data as StoredCredentialRecord[];
  } catch {
    return [];
  }
};

const writeAllCredentials = (records: StoredCredentialRecord[]): void => {
  ensureCredentialsDir();
  const filePath = getCredentialsFilePath();
  writeFileSync(filePath, JSON.stringify(records, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
  // Ensure existing file has restricted permissions (mode may not apply on overwrite)
  try {
    chmodSync(filePath, 0o600);
  } catch {
    // chmod can fail on some platforms; ignore
  }
};

const encryptSecret = (plainText: string): string => {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      "OS-level encryption (safeStorage) is not available. SSH credentials cannot be stored securely on this system."
    );
  }
  const encrypted = safeStorage.encryptString(plainText);
  return encrypted.toString("base64");
};

const decryptSecret = (encrypted: string): string => {
  const buffer = Buffer.from(encrypted, "base64");
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      "OS-level encryption (safeStorage) is not available. Cannot decrypt stored SSH credentials."
    );
  }
  return safeStorage.decryptString(buffer);
};

export const saveSshCredential = (
  record: Omit<SshCredentialRecord, "profileKey">
): SshCredentialRecord => {
  const profileKey = getSshProfileKey({
    host: record.host,
    port: record.port,
    username: record.username,
  });

  const stored: StoredCredentialRecord = {
    profileKey,
    host: record.host,
    port: record.port,
    username: record.username,
    authMethod: record.authMethod,
  };

  if (record.privateKeyPath) {
    stored.privateKeyPath = record.privateKeyPath;
  }

  if (record.encryptedSecret) {
    stored.encryptedSecret = record.encryptedSecret;
  }

  const all = readAllCredentials().filter((r) => r.profileKey !== profileKey);
  all.push(stored);
  writeAllCredentials(all);

  return stored;
};

export const saveSshCredentialWithPlainSecret = (params: {
  host: string;
  port: number;
  username: string;
  authMethod: SshAuthMethod;
  privateKeyPath?: string;
  secret?: string;
}): SshCredentialRecord => {
  const encryptedSecret = params.secret
    ? encryptSecret(params.secret)
    : undefined;

  return saveSshCredential({
    host: params.host,
    port: params.port,
    username: params.username,
    authMethod: params.authMethod,
    privateKeyPath: params.privateKeyPath,
    encryptedSecret,
  });
};

export const getSshCredential = (
  host: string,
  port: number,
  username: string
): SshCredentialRecord | null => {
  const profileKey = getSshProfileKey({ host, port, username });
  const all = readAllCredentials();
  return all.find((r) => r.profileKey === profileKey) ?? null;
};

export const getDecryptedSecret = (
  host: string,
  port: number,
  username: string
): string | null => {
  const record = getSshCredential(host, port, username);
  if (!record || !record.encryptedSecret) {
    return null;
  }
  return decryptSecret(record.encryptedSecret);
};

export const deleteSshCredential = (
  host: string,
  port: number,
  username: string
): void => {
  const profileKey = getSshProfileKey({ host, port, username });
  const all = readAllCredentials().filter((r) => r.profileKey !== profileKey);
  writeAllCredentials(all);
};

export const listSshCredentials = (): SshCredentialRecord[] => {
  return readAllCredentials();
};
