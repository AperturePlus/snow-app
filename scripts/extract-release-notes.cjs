#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const rawTag = process.argv[2];
if (!rawTag) {
  console.error('Usage: node scripts/extract-release-notes.cjs <tag>');
  process.exit(1);
}

// 清理可能的 refs/tags/ 前缀
const tag = rawTag.replace(/^refs\/tags\//, '');

const notesFile = path.join(__dirname, '..', 'RELEASE_NOTES.md');
const outputFile = path.join(process.cwd(), 'release_body.md');

if (!fs.existsSync(notesFile)) {
  console.error(`RELEASE_NOTES.md not found at ${notesFile}`);
  fs.writeFileSync(outputFile, '');
  process.exit(0);
}

const content = fs.readFileSync(notesFile, 'utf8');
const lines = content.split('\n');

let inSection = false;
let output = [];

for (const line of lines) {
  // 检测版本标题行: ## v0.1.11
  if (/^##\s+v\d/.test(line)) {
    if (inSection) break; // 遇到下一个版本段，结束提取
    if (line.trim() === `## ${tag}`) {
      inSection = true;
      continue; // 跳过标题行本身
    }
  } else if (inSection) {
    output.push(line);
  }
}

if (!inSection) {
  console.warn(`Warning: No release notes found for tag "${tag}" in RELEASE_NOTES.md`);
  // 写入空文件，不阻塞流程（generate_release_notes 仍会生成自动日志）
  fs.writeFileSync(outputFile, '');
  process.exit(0);
}

// 去除尾部空行
while (output.length > 0 && output[output.length - 1].trim() === '') {
  output.pop();
}

const body = output.join('\n').trim();
fs.writeFileSync(outputFile, body);
console.log(`Extracted release notes for ${tag} (${body.length} chars) -> release_body.md`);
