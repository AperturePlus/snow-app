import { FilePlus, FileMinus, FileEdit, FileX, Plus } from "lucide-react";
import type { GitFileStatus } from "../../../../preload";
import { useI18n } from "../../../i18n";
import { getFileTypeIcon } from "../../../utils/fileIcons";

type GitFileListProps = {
  files: GitFileStatus[];
  section: "staged" | "unstaged";
  selectedPaths: Set<string>;
  actionInProgress: boolean;
  onFileSelect: (
    file: GitFileStatus,
    e: React.MouseEvent,
    section: "staged" | "unstaged"
  ) => void;
  onStageToggle: (
    files: GitFileStatus[],
    section: "staged" | "unstaged"
  ) => void;
  onStageAll?: () => void;
  onUnstageAll?: () => void;
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
  selectedPaths,
  actionInProgress,
  onFileSelect,
  onStageToggle,
  onStageAll,
  onUnstageAll,
}: GitFileListProps): React.JSX.Element => {
  const { t } = useI18n();
  const isStaged = section === "staged";
  const headerLabel = isStaged ? t("git.stagedChanges") : t("git.changes");
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
          {isStaged
            ? headerCount > 0 && (
                <button
                  type="button"
                  className="git-file-list-action"
                  onClick={onUnstageAll}
                  disabled={actionInProgress}
                  title={t("git.unstageAll")}
                >
                  <span>{"-"}</span>
                </button>
              )
            : headerCount > 0 && (
                <button
                  type="button"
                  className="git-file-list-action"
                  onClick={onStageAll}
                  disabled={actionInProgress}
                  title={t("git.stageAll")}
                >
                  <Plus size={13} strokeWidth={1.8} />
                </button>
              )}
        </div>
      </div>
      {files.length === 0 ? (
        <div className="git-file-list-empty">
          {isStaged ? t("git.noStagedChanges") : t("git.noChanges")}
        </div>
      ) : (
        <div className="git-file-list-items">
          {files.map((file) => {
            const isSelected = selectedPaths.has(`${section}:${file.path}`);
            return (
              <div
                key={`${section}-${file.path}`}
                className={`git-file-item${isSelected ? " selected" : ""}`}
                onClick={(e) => onFileSelect(file, e, section)}
              >
                <span
                  className={`git-file-status ${getStatusColor(file.status)}`}
                >
                  {getStatusLabel(file.status)}
                </span>
                <span
                  className={`git-file-name${
                    file.status === "D" ? " deleted" : ""
                  }`}
                  title={file.path}
                >
                  {getFileTypeIcon(
                    file.path.split("/").pop() ?? file.path,
                    false,
                    false,
                    { size: 13, className: "git-file-type-icon" }
                  )}
                  {file.path}
                </span>
                <button
                  type="button"
                  className="git-file-action"
                  onClick={(e) => {
                    e.stopPropagation();
                    const filesToToggle = isSelected
                      ? files.filter((f) =>
                          selectedPaths.has(`${section}:${f.path}`)
                        )
                      : [file];
                    onStageToggle(filesToToggle, section);
                  }}
                  disabled={actionInProgress}
                  title={isStaged ? t("git.unstageFile") : t("git.stageFile")}
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
