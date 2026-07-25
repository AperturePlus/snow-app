import { useEffect, useMemo, useRef, useState } from "react";
import { DiffModeEnum, DiffView, getLang } from "@git-diff-view/react";
import { DiffFile, generateDiffFile } from "@git-diff-view/file";
import { structuredPatch } from "diff";

import "@git-diff-view/react/styles/diff-view.css";

type DiffTheme = "light" | "dark";

/** 容器宽度达到该值时使用双列(Split)模式,否则使用单列(Unified)模式 */
const SPLIT_MIN_WIDTH = 720;

/** 监听全局 data-theme 属性,返回当前生效的亮/暗主题。 */
const useDiffViewTheme = (): DiffTheme => {
  const getTheme = (): DiffTheme =>
    document.documentElement.getAttribute("data-theme") === "dark"
      ? "dark"
      : "light";
  const [theme, setTheme] = useState<DiffTheme>(getTheme);

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(getTheme()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  return theme;
};

/** 根据容器宽度自动切换单列(Unified)/双列(Split)显示。 */
const useAutoDiffMode = (): {
  containerRef: React.RefObject<HTMLDivElement | null>;
  mode: DiffModeEnum;
} => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<DiffModeEnum>(DiffModeEnum.Unified);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setMode(
        width >= SPLIT_MIN_WIDTH ? DiffModeEnum.Split : DiffModeEnum.Unified
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { containerRef, mode };
};

/**
 * 计算两段文本对比的增删行数(仅解析 diff,不做语法高亮,开销较小)。
 */
export const getCompareDiffStats = (
  oldContent: string,
  newContent: string
): { additions: number; deletions: number } => {
  if (oldContent.length === 0 && newContent.length === 0) {
    return { additions: 0, deletions: 0 };
  }
  const diffFile = generateDiffFile("a", oldContent, "b", newContent, "", "");
  diffFile.initRaw();
  const stats = {
    additions: diffFile.additionLength,
    deletions: diffFile.deletionLength,
  };
  diffFile.clear();
  return stats;
};

/**
 * 基于两段文本生成 unified diff patch 文本(含 `---` / `+++` header)。
 *
 * - 用于工具调用将差异片段以 patch 形式传递给右侧面板的 diff 预览。
 * - 当提供 oldStartLine / newStartLine 时,hunk header 中的行号会偏移到真实源文件位置。
 * - 返回 null 表示两段文本无差异或生成失败。
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

type GitDiffViewProps = {
  /** 用于推断语法高亮语言的文件名 */
  fileName: string;
  /** git 原始 unified diff 文本(git 模式,传入后忽略 oldContent/newContent) */
  patch?: string | null;
  /** 对比模式的旧内容 */
  oldContent?: string;
  /** 对比模式的新内容 */
  newContent?: string;
  /** diff 内容字号,默认 12 */
  fontSize?: number;
  /**
   * 旧内容在真实文件中的起始行号(1-based)。
   * 用于对比片段时显示正确的源文件行号,而非始终从 1 开始。
   */
  oldStartLine?: number;
  /**
   * 新内容在真实文件中的起始行号(1-based)。
   * 用于对比片段时显示正确的源文件行号,而非始终从 1 开始。
   */
  newStartLine?: number;
};

/**
 * 基于 @git-diff-view/react 的统一差异查看组件。
 *
 * - git 模式: 传入 patch(git 原始 diff 文本)。
 * - 对比模式: 传入 oldContent / newContent,内部通过 jsdiff 生成差异。
 * - 自动跟随全局亮/暗主题,并根据容器宽度自动切换单/双列显示。
 */
export const GitDiffView = ({
  fileName,
  patch,
  oldContent,
  newContent,
  fontSize = 12,
  oldStartLine,
  newStartLine,
}: GitDiffViewProps): React.JSX.Element => {
  const theme = useDiffViewTheme();
  const { containerRef, mode } = useAutoDiffMode();

  /**
   * 当提供了 oldStartLine/newStartLine 时,说明 oldContent/newContent 是文件片段而非完整文件。
   * 复用 generateComparePatch 生成带正确行号偏移的 unified diff 文本,
   * 再预构建 DiffFile 实例(与 compareDiffFile 一致),避免 data 模式的异步初始化导致渲染闪烁。
   */
  const offsetDiffFile = useMemo<DiffFile | null>(() => {
    if (patch) {
      return null;
    }
    const oldStr = oldContent ?? "";
    const newStr = newContent ?? "";
    if (
      (oldStartLine == null || oldStartLine <= 1) &&
      (newStartLine == null || newStartLine <= 1)
    ) {
      return null;
    }

    const patchText = generateComparePatch(
      fileName,
      oldStr,
      newStr,
      oldStartLine,
      newStartLine
    );
    if (!patchText) {
      return null;
    }

    try {
      const lang = getLang(fileName);
      const diffFile = new DiffFile(
        fileName,
        "",
        fileName,
        "",
        [patchText],
        lang,
        lang
      );
      diffFile.initTheme(theme);
      diffFile.initRaw();
      diffFile.init();
      diffFile.buildSplitDiffLines();
      diffFile.buildUnifiedDiffLines();
      return diffFile;
    } catch {
      return null;
    }
  }, [patch, fileName, oldContent, newContent, oldStartLine, newStartLine, theme]);

  const patchData = useMemo(
    () =>
      patch
        ? {
            oldFile: { fileName, content: null as string | null },
            newFile: { fileName, content: null as string | null },
            hunks: [patch],
          }
        : null,
    [patch, fileName]
  );

  const compareDiffFile = useMemo<DiffFile | null>(() => {
    if (patch || offsetDiffFile) {
      return null;
    }
    const lang = getLang(fileName);
    const diffFile = generateDiffFile(
      fileName,
      oldContent ?? "",
      fileName,
      newContent ?? "",
      lang,
      lang
    );
    diffFile.initTheme(theme);
    diffFile.init();
    diffFile.buildSplitDiffLines();
    diffFile.buildUnifiedDiffLines();
    return diffFile;
  }, [patch, offsetDiffFile, fileName, oldContent, newContent, theme]);

  const renderDiffFile = patchData ? null : offsetDiffFile ?? compareDiffFile;

  return (
    <div className="git-diff-view" ref={containerRef}>
      {patchData ? (
        <DiffView
          data={patchData}
          diffViewMode={mode}
          diffViewTheme={theme}
          diffViewHighlight
          diffViewWrap
          diffViewFontSize={fontSize}
        />
      ) : renderDiffFile ? (
        <DiffView
          diffFile={renderDiffFile}
          diffViewMode={mode}
          diffViewTheme={theme}
          diffViewHighlight
          diffViewWrap
          diffViewFontSize={fontSize}
        />
      ) : null}
    </div>
  );
};
