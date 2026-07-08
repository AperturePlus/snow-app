/**
 * Ensures node-pty's conpty.dll is copied to the expected build/Release
 * location on Windows.
 *
 * node-pty's own post-install.js is supposed to copy conpty.dll from
 * third_party/conpty/<version>/win10-<arch>/ to build/Release/conpty/, but
 * it may not have run (e.g. certain package manager configurations skip
 * lifecycle scripts, or the script ran before build/Release existed).
 *
 * This script is a safety net that re-runs node-pty's post-install.js.
 * It is non-fatal on failure: ptyManager.ts ensureConptyDll() provides a
 * runtime fallback that performs the same copy when the app starts.
 */

const { existsSync } = require("node:fs");
const { execSync } = require("node:child_process");
const { join } = require("node:path");

const projectRoot = require("node:path").resolve(__dirname, "..");

if (process.platform !== "win32") {
  console.log("[ensure-conpty-dll] Skipped (not Windows)");
  process.exit(0);
}

const postInstallScript = join(
  projectRoot,
  "node_modules",
  "node-pty",
  "scripts",
  "post-install.js"
);

if (!existsSync(postInstallScript)) {
  console.log("[ensure-conpty-dll] Skipped (node-pty post-install.js not found)");
  process.exit(0);
}

try {
  execSync(`node "${postInstallScript}"`, { stdio: "pipe" });
  console.log("[ensure-conpty-dll] conpty.dll ensured");
} catch {
  // Non-fatal: ptyManager.ts ensureConptyDll() will retry at runtime
  console.warn(
    "[ensure-conpty-dll] Warning: could not run node-pty post-install; runtime fallback will be used"
  );
}
