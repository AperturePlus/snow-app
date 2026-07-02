import { FilePlus, FileMinus, FileEdit, FileX, Plus } from "lucide-react";
import type { GitFileStatus } from "../../../preload";

type GitFileListProps = {
  files: GitFileStatus[];
  section: "staged" | "unstaged";
  onFileSelect: (file: GitFileStatus) => void;
  onStageToggle: (file: GitFileStatus) => void;
  onStageAll?: () => void;
  onUnstageAll?: () => void;
  selectedPath: string | null;
};

const getStatusIcon = (status: string): React.ReactNode => {
  switch (status) {
    case "A":
      return <FilePlus size={13} strokeWidth={1.8} />;
    case "M":
      return <FileEdit size={13} strokeWidth={1.8} />;
    case "D":
      return <FileX size={13} strokeWidth={1.8} />;
    case "U":
      return <FileMinus size={13} strokeWidth={1.8} />;
    case "R":
      return <FileEdit size={13} strokeWidth={1.8} />;
    case "C":
      return <FilePlus size={13} strokeWidth={1.8} />;
    default:
      return <FileEdit size={13} strokeWidth={1.8} />;
  }
};

const getStatusColor = (status: string): string => {
  switch (status) {
    case "A":
      return "git-status-add";
    case "M":
      return "git-status-modify";
    case "D":
      return "git-status-delete";
    case "U":
      return "git-status-untracked";
    case "R":
      return "git-status-rename";
    default:
      return "git-status-modify";
  }
};

const getStatusLabel = (status: string): string => {
  switch (status) {
    case "A":
      return "A";
    case "M":
      return "M";
    case "D":
      return "D";
    case "U":
      return "U";
    case "R":
      return "R";
    case "C":
      return "C";
    default:
      return status;
  }
};

export const GitFileList = ({
  files,
  section,
  onFileSelect,
  onStageToggle,
  onStageAll,
  onUnstageAll,
  selectedPath,
}: GitFileListProps): React.JSX.Element => {
  const isStaged = section === "staged";
  const headerLabel = isStaged ? "Staged Changes" : "Changes";
  const headerCount = files.length;

  return (
    <div className="git-file-list">
      <div className="git-file-list-header">
        <div className="git-file-list-title">
          <span className="git-file-list-label">{headerLabel}</span>
          {headerCount > 0 && (
            <span className="git-file-list-badge">{headerCount}</span>
          )}
        </div>
        <div className="git-file-list-actions">
          {isStaged ? (
            headerCount > 0 && (
              <button
                type="button"
                className="git-file-list-action"
                onClick={onUnstageAll}
                title="Unstage all"
              >
                <span>{"-"}</span>
              </button>
            )
          ) : (
            headerCount > 0 && (
              <button
                type="button"
                className="git-file-list-action"
                onClick={onStageAll}
                title="Stage all"
              >
                <Plus size={13} strokeWidth={1.8} />
              </button>
            )
          )}
        </div>
      </div>
      {files.length === 0 ? (
        <div className="git-file-list-empty">
          {isStaged ? "No staged changes" : "No changes"}
        </div>
      ) : (
        <div className="git-file-list-items">
          {files.map((file) => {
            const isSelected = file.path === selectedPath;
            return (
              <div
                key={`${section}-${file.path}`}
                className={`git-file-item${isSelected ? " selected" : ""}`}
                onClick={() => onFileSelect(file)}
              >
                <span className={`git-file-status ${getStatusColor(file.status)}`}>
                  {getStatusLabel(file.status)}
                </span>
                <span className="git-file-name" title={file.path}>
                  {file.path}
                </span>
                <button
                  type="button"
                  className="git-file-action"
                  onClick={(e) => {
                    e.stopPropagation();
                    onStageToggle(file);
                  }}
                  title={isStaged ? "Unstage file" : "Stage file"}
                >
                  <span>{isStaged ? "-" : "+"}</span>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
