import { useEffect, useMemo, useRef, useState } from "react";
import { DiffModeEnum, DiffView, getLang } from "@git-diff-view/react";
import { generateDiffFile } from "@git-diff-view/file";
import type { DiffFile } from "@git-diff-view/file";

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
}: GitDiffViewProps): React.JSX.Element => {
  const theme = useDiffViewTheme();
  const { containerRef, mode } = useAutoDiffMode();

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
    if (patch) {
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
  }, [patch, fileName, oldContent, newContent, theme]);

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
      ) : compareDiffFile ? (
        <DiffView
          diffFile={compareDiffFile}
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
