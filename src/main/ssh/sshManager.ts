import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require2 = createRequire(import.meta.url);
const ssh2 = require2("ssh2") as typeof import("ssh2");
const { Client } = ssh2;

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

export type SshSession = {
  id: string;
  client: import("ssh2").Client;
  sftp: import("ssh2").SFTPWrapper;
  params: SshConnectParams;
};

const sessions = new Map<string, SshSession>();

const generateSessionId = (): string =>
  `ssh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const getSshProfileKey = (params: {
  host: string;
  port: number;
  username: string;
}): string => `${params.username}@${params.host}:${params.port}`;

export const connectSsh = (params: SshConnectParams): Promise<string> => {
  return new Promise((resolve, reject) => {
    let settled = false;
    const client = new Client();

    const connectConfig: Record<string, unknown> = {
      host: params.host,
      port: params.port,
      username: params.username,
      readyTimeout: 15000,
    };

    if (params.authMethod === "password" && params.password) {
      connectConfig.password = params.password;
    } else if (params.authMethod === "privateKey" && params.privateKeyPath) {
      try {
        connectConfig.privateKey = readFileSync(params.privateKeyPath, "utf-8");
      } catch {
        reject(
          new Error(`Failed to read private key file: ${params.privateKeyPath}`)
        );
        return;
      }
      if (params.passphrase) {
        connectConfig.passphrase = params.passphrase;
      }
    } else if (params.authMethod === "agent") {
      const https = require2("node:https") as typeof import("node:https");
      connectConfig.agent = new https.Agent();
    } else {
      reject(new Error("Invalid authentication method or missing credentials"));
      return;
    }

    client.on("ready", () => {
      client.sftp(
        (err: Error | undefined, sftp: import("ssh2").SFTPWrapper) => {
          if (err) {
            if (!settled) {
              settled = true;
              client.end();
              reject(new Error(`SFTP initialization failed: ${err.message}`));
            }
            return;
          }

          const id = generateSessionId();
          const session: SshSession = { id, client, sftp, params };
          sessions.set(id, session);
          if (!settled) {
            settled = true;
            resolve(id);
          }
        }
      );
    });

    client.on("error", (err: Error) => {
      if (!settled) {
        settled = true;
        reject(new Error(err.message));
      }
    });

    client.on("close", () => {
      for (const [id, session] of sessions) {
        if (session.client === client) {
          sessions.delete(id);
          break;
        }
      }
      if (!settled) {
        settled = true;
        reject(new Error("SSH connection closed before establishing session"));
      }
    });

    try {
      client.connect(connectConfig);
    } catch (err) {
      if (!settled) {
        settled = true;
        reject(new Error(err instanceof Error ? err.message : String(err)));
      }
    }
  });
};

export const listSshDirectory = (
  sessionId: string,
  remotePath: string
): Promise<SshDirectoryEntry[]> => {
  return new Promise((resolve, reject) => {
    const session = sessions.get(sessionId);
    if (!session) {
      reject(new Error("SSH session not found. Please reconnect."));
      return;
    }

    session.sftp.readdir(remotePath, (err, list) => {
      if (err) {
        reject(new Error(`Failed to read remote directory: ${err.message}`));
        return;
      }

      const entries: SshDirectoryEntry[] = list.map((item) => {
        const isDirectory = item.attrs.isDirectory();
        const name = item.filename;
        const fullPath =
          remotePath === "/" ? `/${name}` : `${remotePath}/${name}`;
        return {
          name,
          path: fullPath,
          isDirectory,
          size: isDirectory ? 0 : item.attrs.size,
        };
      });

      entries.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) {
          return a.isDirectory ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

      resolve(entries);
    });
  });
};

export const disconnectSsh = (sessionId: string): void => {
  const session = sessions.get(sessionId);
  if (!session) {
    return;
  }
  try {
    session.sftp.end();
    session.client.end();
  } catch {
    // Ignore
  }
  sessions.delete(sessionId);
};

export const disconnectAllSsh = (): void => {
  for (const [, session] of sessions) {
    try {
      session.sftp.end();
      session.client.end();
    } catch {
      // Ignore
    }
  }
  sessions.clear();
};

export const isSshPath = (path: string): boolean => path.startsWith("ssh://");

export type ParsedSshUrl = {
  host: string;
  port: number;
  username: string;
  remotePath: string;
};

export const parseSshUrl = (sshUrl: string): ParsedSshUrl => {
  const withoutPrefix = sshUrl.replace(/^ssh:\/\//, "");
  const atIndex = withoutPrefix.indexOf("@");
  if (atIndex < 0) {
    throw new Error("Invalid SSH URL: missing username");
  }
  const username = withoutPrefix.slice(0, atIndex);
  const hostPortAndPath = withoutPrefix.slice(atIndex + 1);
  const slashIndex = hostPortAndPath.indexOf("/");
  const hostPort =
    slashIndex >= 0 ? hostPortAndPath.slice(0, slashIndex) : hostPortAndPath;
  const remotePath = slashIndex >= 0 ? hostPortAndPath.slice(slashIndex) : "/";
  const colonIndex = hostPort.indexOf(":");
  const host = colonIndex >= 0 ? hostPort.slice(0, colonIndex) : hostPort;
  const port =
    colonIndex >= 0 ? parseInt(hostPort.slice(colonIndex + 1), 10) : 22;
  return { host, port, username, remotePath };
};

export const buildSshUrl = (parsed: ParsedSshUrl): string =>
  `ssh://${parsed.username}@${parsed.host}:${parsed.port}${parsed.remotePath}`;
