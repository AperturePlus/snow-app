/**
 * 修复 node-pty 的 spawn-helper 执行权限。
 *
 * 背景：node-pty 1.1.0 的 npm 包把 prebuilds/darwin-arm64、darwin-x64 下的
 * spawn-helper 以 0644 发布（没有执行位），而它自己的 scripts/post-install.js
 * 只清理 build/Release，从不修复 prebuilds。macOS 上 node-pty 把 spawn-helper
 * 当作 posix_spawn 的可执行文件，缺执行位时 spawn 直接失败，集成终端报
 * 「posix_spawnp failed.」。
 *
 * 两个入口：
 *   1) postinstall（本地开发）：修复 node_modules/node-pty 下的 helper；
 *   2) electron-builder afterPack（打包产物）：修复 app.asar.unpacked 下的
 *      helper —— asar 解包只按源文件的 mode 写盘，不会补上执行位。
 *
 * 为什么打包产物必须在这里修：应用内的运行时兜底
 * （src/main/pty/ptyManager.ts 的 ensureSpawnHelperExecutable）只能覆盖安装目录
 * 可写的场景；装到 /Applications 等只读位置时无法补救，终端依然起不来。
 */

const fs = require("node:fs");
const path = require("node:path");

const HELPER_NAME = "spawn-helper";
/** node-pty 查找原生模块与 helper 的全部位置（见 lib/utils.js）。 */
const CANDIDATE_SUBDIRS = ["build", "prebuilds"];
const EXEC_BITS = 0o111;
const MAX_WALK_DEPTH = 4;

/** 收集 dir 下所有 spawn-helper 的绝对路径。 */
function collectSpawnHelpers(rootDir) {
  const found = [];
  const walk = (dir, depth) => {
    if (depth > MAX_WALK_DEPTH) {
      return;
    }
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else if (entry.isFile() && entry.name === HELPER_NAME) {
        found.push(full);
      }
    }
  };
  for (const sub of CANDIDATE_SUBDIRS) {
    walk(path.join(rootDir, sub), 0);
  }
  return found;
}

/**
 * 给 rootDir 下缺失执行位的 spawn-helper 补上 0755。
 * 返回实际被修改的文件路径列表。
 */
function fixSpawnHelpers(rootDir) {
  const fixed = [];
  for (const helper of collectSpawnHelpers(rootDir)) {
    let stat;
    try {
      stat = fs.statSync(helper);
    } catch {
      continue;
    }
    if ((stat.mode & EXEC_BITS) !== 0) {
      continue;
    }
    fs.chmodSync(helper, 0o755);
    fixed.push(helper);
  }
  return fixed;
}

/** node_modules 里 node-pty 包目录。 */
function resolveNodePtyRoot() {
  return path.dirname(require.resolve("node-pty/package.json"));
}

/**
 * electron-builder afterPack 钩子：把打包产物里的 spawn-helper 修成可执行。
 * macOS 的 dmg/zip 由 asar 解包产生，权限位来自源文件（0644），必须在这里补。
 */
async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") {
    return;
  }
  const resourcesDir = context.packager.getResourcesDir(context.appOutDir);
  const ptyRoot = path.join(
    resourcesDir,
    "app.asar.unpacked",
    "node_modules",
    "node-pty",
  );
  if (!fs.existsSync(ptyRoot)) {
    throw new Error(
      `Packaged node-pty is missing at ${ptyRoot}; check asarUnpack for node_modules/node-pty`,
    );
  }
  if (collectSpawnHelpers(ptyRoot).length === 0) {
    // helper 是 macOS 上 spawn 终端的必要条件，缺失说明产物本身有问题。
    throw new Error(`Packaged spawn-helper is missing under ${ptyRoot}`);
  }
  const fixed = fixSpawnHelpers(ptyRoot);
  if (fixed.length > 0) {
    console.log(`[fix-pty-spawn-helper] chmod 0755: ${fixed.join(", ")}`);
  } else {
    console.log("[fix-pty-spawn-helper] spawn-helper already executable");
  }
}

module.exports = afterPack;
module.exports.collectSpawnHelpers = collectSpawnHelpers;
module.exports.fixSpawnHelpers = fixSpawnHelpers;

if (require.main === module) {
  // postinstall 入口：仅 macOS/Linux 需要，Windows 走 ConPTY 用不到 helper。
  if (process.platform === "win32") {
    console.log("[fix-pty-spawn-helper] Skipped (not required on Windows)");
    process.exit(0);
  }
  try {
    const ptyRoot = resolveNodePtyRoot();
    const fixed = fixSpawnHelpers(ptyRoot);
    console.log(
      fixed.length > 0
        ? `[fix-pty-spawn-helper] chmod 0755: ${fixed.join(", ")}`
        : "[fix-pty-spawn-helper] spawn-helper already executable",
    );
  } catch (error) {
    // 依赖尚未安装完整时不应中断 npm install。
    console.warn("[fix-pty-spawn-helper] Skipped:", error.message);
  }
}
