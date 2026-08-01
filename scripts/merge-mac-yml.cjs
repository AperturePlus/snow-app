#!/usr/bin/env node
'use strict';

/**
 * Merge arm64 and x64 latest-mac.yml into a single unified yml.
 *
 * Background: the CI builds arm64 and x64 in separate jobs, each producing
 * its own latest-mac.yml. After download-artifact merges them into one
 * directory we end up with:
 *   release/latest-mac.yml        (x64)
 *   release/latest-mac-arm64.yml  (arm64, renamed in the build job)
 *
 * electron-updater reads a single latest-mac.yml and picks the correct
 * architecture from the `files` array based on the url suffix. This script
 * merges both files into one so that auto-update works for both archs.
 */

const fs = require('fs');
const path = require('path');

const releaseDir = path.resolve(__dirname, '..', 'release');
const x64YmlPath = path.join(releaseDir, 'latest-mac.yml');
const arm64YmlPath = path.join(releaseDir, 'latest-mac-arm64.yml');

if (!fs.existsSync(x64YmlPath) && !fs.existsSync(arm64YmlPath)) {
  console.log('[merge-mac-yml] No macOS yml found, skipping.');
  process.exit(0);
}

if (!fs.existsSync(arm64YmlPath)) {
  console.log('[merge-mac-yml] Only one yml present (no arm64), nothing to merge.');
  process.exit(0);
}

if (!fs.existsSync(x64YmlPath)) {
  // Only arm64 exists — just rename it.
  fs.renameSync(arm64YmlPath, x64YmlPath);
  console.log('[merge-mac-yml] Only arm64 yml present, renamed to latest-mac.yml.');
  process.exit(0);
}

// ---- Simple YAML parser tailored for latest-mac.yml structure ----
function parseMacYml(content) {
  const result = { files: [] };
  const lines = content.split('\n');
  let currentFile = null;
  let inFiles = false;

  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    if (/^version:/.test(line)) {
      result.version = line.substring(line.indexOf(':') + 1).trim();
    } else if (/^files:/.test(line)) {
      inFiles = true;
    } else if (/^  -\s+url:/.test(line)) {
      if (currentFile) result.files.push(currentFile);
      currentFile = { url: line.substring(line.indexOf('url:') + 4).trim() };
    } else if (/^\s+sha512:/.test(line) && currentFile && inFiles) {
      currentFile.sha512 = line.substring(line.indexOf('sha512:') + 7).trim();
    } else if (/^\s+size:/.test(line) && currentFile && inFiles) {
      currentFile.size = parseInt(line.substring(line.indexOf('size:') + 5).trim(), 10);
    } else if (/^path:/.test(line)) {
      result.path = line.substring(line.indexOf(':') + 1).trim();
      inFiles = false;
    } else if (/^sha512:/.test(line) && !inFiles) {
      result.sha512 = line.substring(line.indexOf(':') + 1).trim();
    } else if (/^releaseDate:/.test(line)) {
      result.releaseDate = line.substring(line.indexOf(':') + 1).trim();
    }
  }
  if (currentFile) result.files.push(currentFile);
  return result;
}

function stringifyMacYml(obj) {
  const lines = [];
  lines.push(`version: ${obj.version}`);
  lines.push('files:');
  for (const f of obj.files) {
    lines.push(`  - url: ${f.url}`);
    if (f.sha512) lines.push(`    sha512: ${f.sha512}`);
    if (f.size !== undefined) lines.push(`    size: ${f.size}`);
  }
  if (obj.path) lines.push(`path: ${obj.path}`);
  if (obj.sha512) lines.push(`sha512: ${obj.sha512}`);
  if (obj.releaseDate) lines.push(`releaseDate: ${obj.releaseDate}`);
  return lines.join('\n') + '\n';
}

const x64 = parseMacYml(fs.readFileSync(x64YmlPath, 'utf8'));
const arm64 = parseMacYml(fs.readFileSync(arm64YmlPath, 'utf8'));

// Merge: arm64 files first, then x64 (order doesn't matter for electron-updater,
// it picks the matching arch by url suffix).
const merged = {
  version: x64.version || arm64.version,
  files: [...arm64.files, ...x64.files],
  path: arm64.path || x64.path,
  sha512: arm64.sha512 || x64.sha512,
  releaseDate: x64.releaseDate || arm64.releaseDate,
};

fs.writeFileSync(x64YmlPath, stringifyMacYml(merged));
fs.unlinkSync(arm64YmlPath);

console.log('[merge-mac-yml] Merged latest-mac.yml:');
console.log(stringifyMacYml(merged));
