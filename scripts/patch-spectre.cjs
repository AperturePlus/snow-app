/**
 * Patch node-pty binding.gyp files to remove SpectreMitigation requirement.
 *
 * node-pty sets 'SpectreMitigation': 'Spectre' in msvs_configuration_attributes,
 * which requires Visual Studio's Spectre-mitigated libraries to be installed.
 * Most development environments don't have these libraries, causing MSB8040 errors.
 * This script removes that attribute so the build can proceed without them.
 */

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");

/** @type {Array<{file: string, pattern: RegExp, description: string}>} */
const patches = [
  {
    file: path.join(projectRoot, "node_modules", "node-pty", "binding.gyp"),
    pattern: /'msvs_configuration_attributes':\s*\{\s*'SpectreMitigation':\s*'Spectre'\s*\},?/g,
    description: "node-pty/binding.gyp",
  },
  {
    file: path.join(
      projectRoot,
      "node_modules",
      "node-pty",
      "deps",
      "winpty",
      "src",
      "winpty.gyp",
    ),
    pattern: /'msvs_configuration_attributes':\s*\{\s*'SpectreMitigation':\s*'Spectre'\s*\},?/g,
    description: "node-pty/deps/winpty/src/winpty.gyp",
  },
];

let patched = 0;

for (const { file, pattern, description } of patches) {
  if (!fs.existsSync(file)) {
    continue;
  }

  const content = fs.readFileSync(file, "utf-8");

  if (!pattern.test(content)) {
    continue;
  }

  // Reset lastIndex since we used the global flag
  pattern.lastIndex = 0;
  const newContent = content.replace(pattern, "");

  fs.writeFileSync(file, newContent, "utf-8");
  console.log(`[patch-spectre] Patched ${description}`);
  patched++;
}

if (patched === 0) {
  console.log("[patch-spectre] No patches needed (already clean or files not found)");
} else {
  console.log(`[patch-spectre] Done, ${patched} file(s) patched`);
}
