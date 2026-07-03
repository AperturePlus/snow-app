import type { GitDiffResult, GitFileStatus } from "./git";
import type { DiffLine } from "./types";

export const parseDiffContent = (diffContent: string): DiffLine[] => {
  const lines = diffContent.split("\n");
  const result: DiffLine[] = [];
  let oldLineNum = 0;
  let newLineNum = 0;

  for (const line of lines) {
    if (line.startsWith("@@")) {
      // Parse hunk header: @@ -oldStart,oldCount +newStart,newCount @@
      const match = line.match(
        /@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/
      );
      if (match) {
        oldLineNum = parseInt(match[1], 10);
        newLineNum = parseInt(match[3], 10);
      }
      result.push({
        type: "hunk",
        content: line,
        oldNum: "",
        newNum: "",
      });
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      result.push({
        type: "add",
        content: line.slice(1),
        oldNum: "",
        newNum: String(newLineNum++),
      });
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      result.push({
        type: "del",
        content: line.slice(1),
        oldNum: String(oldLineNum++),
        newNum: "",
      });
    } else if (line.startsWith(" ")) {
      result.push({
        type: "context",
        content: line.slice(1),
        oldNum: String(oldLineNum++),
        newNum: String(newLineNum++),
      });
    } else if (line.startsWith("\\") || line.includes("Binary files")) {
      // Skip binary diff markers
    } else {
      // Diff header lines (diff --git, index, ---, +++), skip them
    }
  }

  return result;
};

type DiffViewerProps = {
  selectedFile: GitFileStatus;
  diffResult: GitDiffResult | null;
  diffLoading: boolean;
};

export function DiffViewer({
  selectedFile,
  diffResult,
  diffLoading,
}: DiffViewerProps): React.JSX.Element {
  const diffLines = diffResult ? parseDiffContent(diffResult.content) : [];

  return (
    <div className="diff-viewer">
      <div className="diff-viewer-header">
        <span className="diff-viewer-file-name" title={selectedFile.path}>
          {selectedFile.path}
        </span>
      </div>
      {diffLoading ? (
        <div className="diff-viewer-loading">Loading diff...</div>
      ) : diffResult?.isBinary ? (
        <div className="diff-viewer-binary">Binary file</div>
      ) : diffLines.length > 0 ? (
        <div className="diff-viewer-content">
          {diffLines.map((line, i) => (
            <div key={i} className={`diff-line ${line.type}`}>
              {line.type === "hunk" ? (
                <code className="diff-code hunk-header">{line.content}</code>
              ) : (
                <>
                  <span className="diff-linenum old">{line.oldNum}</span>
                  <span className="diff-linenum new">{line.newNum}</span>
                  <span className="diff-marker">
                    {line.type === "add"
                      ? "+"
                      : line.type === "del"
                      ? "-"
                      : " "}
                  </span>
                  <code className="diff-code">{line.content}</code>
                </>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="diff-viewer-empty">No changes to display</div>
      )}
    </div>
  );
}
