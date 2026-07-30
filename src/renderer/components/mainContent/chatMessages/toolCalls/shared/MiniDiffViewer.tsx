import { lazy, memo, Suspense } from "react";
import { ExternalLink } from "lucide-react";

// GitDiffView 依赖 @git-diff-view（~1.2MB），懒加载避免打入首屏 chunk。
const GitDiffView = lazy(() =>
  import("../../../../common/GitDiffView").then((m) => ({
    default: m.GitDiffView,
  }))
);

type MiniDiffViewerProps = {
  fileName: string;
  oldContent: string;
  newContent: string;
  /**
   * 旧内容在真实源文件中的起始行号(1-based)。
   * 用于编辑工具调用时,让 diff 显示正确的源文件行号而非始终从 1 开始。
   */
  startLine?: number;
  /** 在右侧面板新标签页中查看完整 diff 的回调;未提供时不渲染按钮。 */
  onOpenInTab?: () => void;
  /** 打开按钮的 title / aria-label 文案。 */
  openInTabLabel?: string;
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
    onOpenInTab,
    openInTabLabel,
  }: MiniDiffViewerProps): React.JSX.Element => (
    <div className="tool-call-diff-content">
      <div className="tool-call-diff-view">
        <Suspense fallback={null}>
          <GitDiffView
            fileName={fileName}
            oldContent={oldContent}
            newContent={newContent}
            fontSize={11}
            oldStartLine={startLine}
            newStartLine={startLine}
          />
        </Suspense>
      </div>
      {onOpenInTab ? (
        <button
          type="button"
          className="tool-call-diff-open-tab"
          onClick={onOpenInTab}
          title={openInTabLabel}
          aria-label={openInTabLabel}
        >
          <ExternalLink size={11} strokeWidth={1.8} />
        </button>
      ) : null}
    </div>
  )
);

MiniDiffViewer.displayName = "MiniDiffViewer";
