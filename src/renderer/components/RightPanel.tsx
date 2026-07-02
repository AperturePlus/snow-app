import { useEffect, useState } from "react";
import type {
  GitDiffResult,
  GitFileStatus,
  GitStatusResult,
  WorkspaceDirectoryRecord,
} from "../../preload";
import { GitControl } from "./git";

type RightPanelProps = {
  isCollapsed: boolean;
  activeDirectory?: WorkspaceDirectoryRecord | null;
};

type DiffLine = {
  type: "context" | "add" | "del" | "hunk";
  content: string;
  oldNum: string;
  newNum: string;
};

const parseDiffContent = (diffContent: string): DiffLine[] => {
  const lines = diffContent.split("\n");
  const result: DiffLine[] = [];

  for (const line of lines) {
    if (line.startsWith("@@")) {
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
        newNum: "",
      });
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      result.push({
        type: "del",
        content: line.slice(1),
        oldNum: "",
        newNum: "",
      });
    } else if (line.startsWith(" ")) {
      result.push({
        type: "context",
        content: line.slice(1),
        oldNum: "",
        newNum: "",
      });
    } else if (line.startsWith("\\") || line.includes("Binary files")) {
      // Skip binary diff markers
    } else {
      // Diff header lines (diff --git, index, ---, +++), skip them
    }
  }

  return result;
};

export const RightPanel = ({
  isCollapsed,
  activeDirectory,
}: RightPanelProps): React.JSX.Element => {
  const [selectedFile, setSelectedFile] = useState<GitFileStatus | null>(null);
  const [diffResult, setDiffResult] = useState<GitDiffResult | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [gitStatus, setGitStatus] = useState<GitStatusResult | null>(null);

  const repoPath = activeDirectory?.path ?? null;

  // Fetch diff when a file is selected
  useEffect(() => {
    if (!repoPath || !selectedFile) {
      setDiffResult(null);
      return;
    }

    setDiffLoading(true);
    const isStaged =
      selectedFile.indexStatus !== " " &&
      selectedFile.indexStatus !== "?" &&
      selectedFile.indexStatus !== "";

    window.snow
      .gitFileDiff(repoPath, selectedFile.path, isStaged)
      .then((result) => {
        setDiffResult(result);
      })
      .catch(() => {
        setDiffResult(null);
      })
      .finally(() => {
        setDiffLoading(false);
      });
  }, [repoPath, selectedFile]);

  const diffLines = diffResult ? parseDiffContent(diffResult.content) : [];

  return (
    <aside className={`right-panel${isCollapsed ? " collapsed" : ""}`}>
      <GitControl
        repoPath={repoPath}
        onFileSelect={setSelectedFile}
        selectedFile={selectedFile}
        onStatusChange={setGitStatus}
      />

      {selectedFile && (
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
                    <code className="diff-code hunk-header">
                      {line.content}
                    </code>
                  ) : (
                    <>
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
      )}

      {!selectedFile && gitStatus && (
        <div className="diff-viewer">
          <div className="diff-viewer-empty">
            Select a file to view its diff
          </div>
        </div>
      )}
    </aside>
  );
};
