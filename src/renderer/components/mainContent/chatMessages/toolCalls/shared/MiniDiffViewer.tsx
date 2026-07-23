import { memo } from "react";

import { GitDiffView } from "../../../../common/GitDiffView";

type MiniDiffViewerProps = {
  fileName: string;
  oldContent: string;
  newContent: string;
  /**
   * 旧内容在真实源文件中的起始行号(1-based)。
   * 用于编辑工具调用时,让 diff 显示正确的源文件行号而非始终从 1 开始。
   */
  startLine?: number;
};

/**
 * 工具调用消息中的紧凑差异视图。
 * 基于 @git-diff-view/react 渲染,支持语法高亮与自动单/双列切换。
 */
export const MiniDiffViewer = memo(
  ({
    fileName,
    oldContent,
    newContent,
    startLine,
  }: MiniDiffViewerProps): React.JSX.Element => (
    <div className="tool-call-diff-content">
      <GitDiffView
        fileName={fileName}
        oldContent={oldContent}
        newContent={newContent}
        fontSize={11}
        oldStartLine={startLine}
        newStartLine={startLine}
      />
    </div>
  )
);

MiniDiffViewer.displayName = "MiniDiffViewer";
