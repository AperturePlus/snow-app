import { structuredPatch } from "diff";

/**
 * 生成 unified diff 文本（仅依赖 "diff" 库，不引入 @git-diff-view）。
 * 从 GitDiffView.tsx 提取出来，避免 RightPanel 等模块因导入此函数
 * 而将 @git-diff-view 拉入首屏 bundle。
 */
export const generateComparePatch = (
  fileName: string,
  oldContent: string,
  newContent: string,
  oldStartLine?: number,
  newStartLine?: number
): string | null => {
  try {
    const result = structuredPatch(
      fileName,
      fileName,
      oldContent,
      newContent,
      undefined,
      undefined,
      { context: 3 }
    );

    if (!result.hunks || result.hunks.length === 0) {
      return null;
    }

    const oldOffset = Math.max(0, (oldStartLine ?? 1) - 1);
    const newOffset = Math.max(0, (newStartLine ?? 1) - 1);

    const patchLines: string[] = [`--- ${fileName}`, `+++ ${fileName}`];
    for (const hunk of result.hunks) {
      const oldStart = hunk.oldStart + oldOffset;
      const newStart = hunk.newStart + newOffset;
      patchLines.push(
        `@@ -${oldStart},${hunk.oldLines} +${newStart},${hunk.newLines} @@`
      );
      patchLines.push(...hunk.lines);
    }
    return patchLines.join("\n");
  } catch {
    return null;
  }
};

/**
 * 计算两段文本对比的增删行数（仅依赖 "diff" 库）。
 * 从 GitDiffView.tsx 提取，避免首屏 chat 组件拉入 @git-diff-view。
 */
export const getCompareDiffStats = (
  oldContent: string,
  newContent: string
): { additions: number; deletions: number } => {
  if (oldContent.length === 0 && newContent.length === 0) {
    return { additions: 0, deletions: 0 };
  }
  try {
    const result = structuredPatch("a", "b", oldContent, newContent, undefined, undefined, {
      context: 0,
    });
    let additions = 0;
    let deletions = 0;
    for (const hunk of result.hunks) {
      for (const line of hunk.lines) {
        if (line.startsWith("+")) {
          additions++;
        } else if (line.startsWith("-")) {
          deletions++;
        }
      }
    }
    return { additions, deletions };
  } catch {
    return { additions: 0, deletions: 0 };
  }
};

