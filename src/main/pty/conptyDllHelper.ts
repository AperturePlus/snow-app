import { createRequire } from "node:module";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { dirname, join } from "node:path";

const require2 = createRequire(import.meta.url);

/**
 * Resolves the directory from which node-pty loads `conpty.node`.
 *
 * node-pty's `utils.loadNativeModule` checks the following directories in
 * order (relative to both `..` and `.` of the `lib/` folder):
 *   1. build/Release
 *   2. build/Debug
 *   3. prebuilds/<platform>-<arch>
 *
 * Returns `null` if `conpty.node` cannot be found in any of them.
 */
const resolveConptyNodeDir = (): string | null => {
  const ptyModulePath = require2.resolve("node-pty");
  const ptyDir = dirname(ptyModulePath); // .../node-pty/lib
  const ptyRoot = dirname(ptyDir); // .../node-pty

  const platformArch = `${process.platform}-${process.arch}`;
  const candidates = [
    join(ptyRoot, "build", "Release"),
    join(ptyRoot, "build", "Debug"),
    join(ptyRoot, "prebuilds", platformArch),
    join(ptyDir, "build", "Release"),
    join(ptyDir, "build", "Debug"),
    join(ptyDir, "prebuilds", platformArch),
  ];

  for (const dir of candidates) {
    if (existsSync(join(dir, "conpty.node"))) {
      return dir;
    }
  }
  return null;
};

/**
 * Collects all possible source paths for `conpty.dll` within the node-pty
 * package directory tree.
 */
const collectConptyDllSources = (): string[] => {
  const ptyModulePath = require2.resolve("node-pty");
  const ptyDir = dirname(ptyModulePath);
  const ptyRoot = dirname(ptyDir);
  const platformArch = `${process.platform}-${process.arch}`;
  const winArch = `win10-${process.arch}`;

  const sources: string[] = [
    // prebuilds
    join(ptyRoot, "prebuilds", platformArch, "conpty", "conpty.dll"),
  ];

  // third_party/conpty/<version>/win10-<arch>/conpty.dll
  const thirdPartyDir = join(ptyRoot, "third_party", "conpty");
  if (existsSync(thirdPartyDir)) {
    for (const entry of readdirSync(thirdPartyDir)) {
      sources.push(join(thirdPartyDir, entry, winArch, "conpty.dll"));
    }
  }

  return sources;
};

/**
 * Ensures `conpty.dll` is available at the location where `conpty.node` will
 * be loaded from.
 *
 * When `useConptyDll: true`, node-pty's native code (`conpty.cc`
 * `LoadConptyDll`) looks for `conpty.dll` at `<conpty.node dir>/conpty/conpty.dll`.
 * The node-pty `post-install.js` script is supposed to copy the DLL there, but
 * it may not have run (e.g. certain package manager configurations skip
 * lifecycle scripts). This function performs a runtime fallback: it detects
 * the missing DLL and copies it from `prebuilds/` or `third_party/`.
 *
 * Returns `true` if `useConptyDll` can be safely enabled (DLL present or
 * successfully copied). Returns `false` to fall back to `useConptyDll: false`,
 * which uses kernel32.dll's built-in ConPTY API — this avoids the DLL
 * dependency but has an `AttachConsole` failure during `kill()` in Electron
 * (5-second timeout before fallback cleanup).
 */
export const ensureConptyDll = (): boolean => {
  if (process.platform !== "win32") {
    return false;
  }

  try {
    const conptyNodeDir = resolveConptyNodeDir();
    if (!conptyNodeDir) {
      return false;
    }

    const dllDir = join(conptyNodeDir, "conpty");
    const dllPath = join(dllDir, "conpty.dll");

    // DLL already in place
    if (existsSync(dllPath)) {
      return true;
    }

    // Try to copy from available sources
    for (const src of collectConptyDllSources()) {
      if (!existsSync(src)) {
        continue;
      }

      mkdirSync(dllDir, { recursive: true });
      copyFileSync(src, dllPath);

      // Also copy OpenConsole.exe from the same source directory if present
      const openConsoleSrc = join(dirname(src), "OpenConsole.exe");
      if (existsSync(openConsoleSrc)) {
        copyFileSync(openConsoleSrc, join(dllDir, "OpenConsole.exe"));
      }

      return true;
    }

    // DLL not available from any source
    return false;
  } catch {
    return false;
  }
};
