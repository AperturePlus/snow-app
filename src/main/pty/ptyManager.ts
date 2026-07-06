import { type WebContents } from "electron";
import { createRequire } from "node:module";
import { chmodSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

const require2 = createRequire(import.meta.url);
const nodePty = require2("node-pty") as typeof import("node-pty");

export type PtySessionOptions = {
  cwd: string;
  cols: number;
  rows: number;
  shellPath?: string;
};

export type PtySession = {
  id: string;
  pty: nodePty.IPty;
  webContents: WebContents;
};

const PTY_OUTPUT_CHANNEL = "pty:output";
const PTY_EXIT_CHANNEL = "pty:exit";

const sessions = new Map<string, PtySession>();

const generatePtyId = (): string =>
  `pty-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const getShell = (): string => {
  if (process.platform === "win32") {
    return process.env.COMSPEC ?? "cmd.exe";
  }
  return process.env.SHELL ?? "/bin/zsh";
};

const getShellArgs = (): string[] => {
  if (process.platform === "win32") {
    return [];
  }
  return ["-l"];
};

const sanitizeEnv = (): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value !== "string") {
      continue;
    }
    // Remove Electron-specific env vars that break child processes
    if (
      key === "ELECTRON_RUN_AS_NODE" ||
      key === "ELECTRON_NO_ATTACH_CONSOLE"
    ) {
      continue;
    }
    env[key] = value;
  }
  if (!env.TERM) {
    env.TERM = "xterm-256color";
  }
  return env;
};

const ensureSpawnHelperExecutable = (): void => {
  if (process.platform === "win32") {
    return;
  }
  try {
    const ptyModulePath = require2.resolve("node-pty");
    const ptyDir = dirname(ptyModulePath);
    const prebuildDir = join(
      ptyDir,
      "..",
      "prebuilds",
      `${process.platform}-${process.arch}`
    );
    const spawnHelperPath = join(prebuildDir, "spawn-helper");
    if (existsSync(spawnHelperPath)) {
      chmodSync(spawnHelperPath, 0o755);
    }
  } catch {
    // Ignore
  }
};

ensureSpawnHelperExecutable();

export const createPtySession = (
  webContents: WebContents,
  options: PtySessionOptions
): string => {
  const id = generatePtyId();
  const customShell = options.shellPath?.trim();
  const shell =
    customShell && existsSync(customShell) ? customShell : getShell();

  const isWindows = process.platform === "win32";

  const pty = nodePty.spawn(shell, getShellArgs(), {
    name: "xterm-256color",
    cols: options.cols,
    rows: options.rows,
    cwd: options.cwd,
    env: sanitizeEnv(),
    // Electron already has a console attached, so the default ConPTY kill path
    // (which forks conpty_console_list_agent.js and calls AttachConsole) throws
    // "AttachConsole failed". Setting useConptyDll routes kill() through a
    // different code path that avoids the fork entirely.
    useConptyDll: isWindows,
  });

  const session: PtySession = { id, pty, webContents };
  sessions.set(id, session);

  pty.onData((data: string) => {
    const wc = sessions.get(id)?.webContents;
    if (wc && !wc.isDestroyed()) {
      wc.send(PTY_OUTPUT_CHANNEL, { id, data });
    }
  });

  pty.onExit(({ exitCode }: { exitCode: number }) => {
    const wc = sessions.get(id)?.webContents;
    if (wc && !wc.isDestroyed()) {
      wc.send(PTY_EXIT_CHANNEL, { id, exitCode });
    }
    sessions.delete(id);
  });

  return id;
};

export const writePtyInput = (id: string, data: string): void => {
  const session = sessions.get(id);
  if (!session) {
    throw new Error(`PTY session not found: ${id}`);
  }
  session.pty.write(data);
};

export const resizePty = (id: string, cols: number, rows: number): void => {
  const session = sessions.get(id);
  if (!session) {
    return;
  }
  try {
    session.pty.resize(cols, rows);
  } catch {
    // Ignore
  }
};

export const killPty = (id: string): void => {
  const session = sessions.get(id);
  if (!session) {
    return;
  }
  try {
    session.pty.kill();
  } catch {
    // Already dead
  }
  sessions.delete(id);
};

export const killAllPtyForWebContents = (webContents: WebContents): void => {
  for (const [id, session] of sessions) {
    if (session.webContents === webContents) {
      try {
        session.pty.kill();
      } catch {
        // Already dead
      }
      sessions.delete(id);
    }
  }
};

export { PTY_OUTPUT_CHANNEL, PTY_EXIT_CHANNEL };
