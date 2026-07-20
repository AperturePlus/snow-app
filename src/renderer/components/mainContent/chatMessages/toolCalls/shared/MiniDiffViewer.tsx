import { memo } from "react";
import type { DiffLine } from "./types";

type MiniDiffViewerProps = {
  diffLines: DiffLine[];
  maxLines?: number;
};

/**
 * Compact diff viewer for tool call messages.
 * Reuses the existing `.diff-line` / `.diff-linenum` / `.diff-marker` / `.diff-code`
 * CSS classes from styles.css to stay visually consistent with the right-panel DiffViewer.
 */
export const MiniDiffViewer = memo(
  ({ diffLines, maxLines }: MiniDiffViewerProps): React.JSX.Element => {
    const visibleLines =
      typeof maxLines === "number" && maxLines > 0
        ? diffLines.slice(0, maxLines)
        : diffLines;
    return (
      <div className="tool-call-diff-content">
        {visibleLines.map((line, idx) => (
          <div key={idx} className={`diff-line ${line.type}`}>
            <span className="diff-linenum old">{line.oldNum}</span>
            <span className="diff-linenum new">{line.newNum}</span>
            <span className="diff-marker">
              {line.type === "add" ? "+" : line.type === "del" ? "-" : " "}
            </span>
            <code className="diff-code">{line.content}</code>
          </div>
        ))}
      </div>
    );
  }
);

MiniDiffViewer.displayName = "MiniDiffViewer";
