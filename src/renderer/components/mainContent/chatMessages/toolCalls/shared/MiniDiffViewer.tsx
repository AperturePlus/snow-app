import { memo } from "react";

import { GitDiffView } from "../../../../common/GitDiffView";

type MiniDiffViewerProps = {
  fileName: string;
  oldContent: string;
  newContent: string;
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
  }: MiniDiffViewerProps): React.JSX.Element => (
    <div className="tool-call-diff-content">
      <GitDiffView
        fileName={fileName}
        oldContent={oldContent}
        newContent={newContent}
        fontSize={11}
      />
    </div>
  )
);

MiniDiffViewer.displayName = "MiniDiffViewer";
