import {
  ChevronDown,
  Copy,
  FileMinus,
  FilePlus,
  FileEdit,
  FileText,
  FileX,
  Plus,
  Terminal as TerminalIcon,
  Undo2,
} from "lucide-react";
import { useCallback, useState } from "react";
import type { GitFileStatus } from "../../../../preload";
import { useI18n } from "../../../i18n";
import { getFileTypeIcon } from "../../../utils/fileIcons";
import { ContextMenu, type ContextMenuItem } from "../../common/ContextMenu";

type GitFileListProps = {
  repoPath: string;
  files: GitFileStatus[];
  section: "staged" | "unstaged";
  selectedPaths: Set<string>;
  actionInProgress: string | null;
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
  onDiscard?: (files: GitFileStatus[]) => void;
  onOpenFile?: (file: GitFileStatus) => void;
  /** 在文件所在目录打开终端。 */
  onOpenTerminal?: (cwd: string) => void;
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
  repoPath,
  files,
  section,
  selectedPaths,
  actionInProgress,
  onFileSelect,
  onStageToggle,
  onStageAll,
  onUnstageAll,
  onDiscard,
  onOpenFile,
  onOpenTerminal,
}: GitFileListProps): React.JSX.Element => {
  const { t } = useI18n();
  const isStaged = section === "staged";
  const headerLabel = isStaged ? t("git.stagedChanges") : t("git.changes");
  const headerCount = files.length;

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    file: GitFileStatus;
  } | null>(null);

  /** 将文件相对路径拼成仓库绝对路径（兼容 Windows 反斜杠与 SSH 仓库）。 */
  const resolveRepoPath = (dirPath: string): string => {
    const base = repoPath.replace(/[\\/]+$/, "");
    const sep = base.includes("\\") ? "\\" : "/";
    const dir = dirPath.replace(/[\\/]+$/, "");
    return dir ? `${base}${sep}${dir}` : base;
  };

  /** 与行内按钮一致的多选语义：右键文件在选中集内时操作应用到全部选中。 */
  const getTargetFiles = (file: GitFileStatus): GitFileStatus[] => {
    if (selectedPaths.has(`${section}:${file.path}`)) {
      const selected = files.filter((f) =>
        selectedPaths.has(`${section}:${f.path}`)
      );
      return selected.length > 0 ? selected : [file];
    }
    return [file];
  };

  const buildMenuItems = (file: GitFileStatus): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [];
    if (onOpenFile && file.status !== "D") {
      items.push({
        id: "open",
        label: t("git.openFile"),
        icon: <FileText size={13} strokeWidth={1.8} />,
        onClick: () => {
          setContextMenu(null);
          onOpenFile(file);
        },
      });
    }
    items.push({
      id: "stage-toggle",
      label: isStaged ? t("git.unstageFile") : t("git.stageFile"),
      icon: isStaged ? (
        <FileMinus size={13} strokeWidth={1.8} />
      ) : (
        <Plus size={13} strokeWidth={1.8} />
      ),
      onClick: () => {
        setContextMenu(null);
        onStageToggle(getTargetFiles(file), section);
      },
    });
    if (!isStaged && onDiscard) {
      items.push({
        id: "discard",
        label: t("git.discardFile"),
        icon: <Undo2 size={13} strokeWidth={1.8} />,
        onClick: () => {
          setContextMenu(null);
          onDiscard(getTargetFiles(file));
        },
      });
    }
    if (onOpenTerminal) {
      items.push({
        id: "open-terminal",
        label: t("git.openInTerminal", {
          defaultValue: "Open in Terminal",
        }),
        icon: <TerminalIcon size={13} strokeWidth={1.8} />,
        onClick: () => {
          setContextMenu(null);
          const lastSep = Math.max(
            file.path.lastIndexOf("/"),
            file.path.lastIndexOf("\\")
          );
          const dirPath = lastSep === -1 ? "" : file.path.slice(0, lastSep + 1);
          onOpenTerminal(resolveRepoPath(dirPath));
        },
      });
    }
    items.push({
      id: "copy-path",
      label: t("git.copyPath", { defaultValue: "Copy Path" }),
      icon: <Copy size={13} strokeWidth={1.8} />,
      onClick: () => {
        setContextMenu(null);
        void window.snow.writeClipboardText(file.path).catch(() => {
          // 剪贴板写入失败时静默忽略。
        });
      },
    });
    return items;
  };

  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(`git-collapse-${section}`) === "true";
    } catch {
      return false;
    }
  });

  const toggleCollapse = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(`git-collapse-${section}`, String(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  };

  const handleFileDragStart = useCallback(
    (event: React.DragEvent<HTMLDivElement>, file: GitFileStatus) => {
      const tag = {
        repoPath,
        path: file.path,
        section,
        status: file.status,
      };
      event.dataTransfer.setData("application/json", JSON.stringify(tag));
      event.dataTransfer.effectAllowed = "copy";
    },
    [repoPath, section]
  );

  return (
    <div className="git-file-list">
      <div className="git-file-list-header">
        <div
          className="git-file-list-title"
          onClick={toggleCollapse}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              toggleCollapse();
            }
          }}
          title={collapsed ? t("git.expandSection") : t("git.collapseSection")}
        >
          <ChevronDown
            size={14}
            strokeWidth={1.8}
            className={`git-file-list-chevron${collapsed ? " collapsed" : ""}`}
          />
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
                  disabled={actionInProgress !== null}
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
                  disabled={actionInProgress !== null}
                  title={t("git.stageAll")}
                >
                  <Plus size={13} strokeWidth={1.8} />
                </button>
              )}
        </div>
      </div>
      {!collapsed &&
        (files.length === 0 ? (
          <div className="git-file-list-empty">
            {isStaged ? t("git.noStagedChanges") : t("git.noChanges")}
          </div>
        ) : (
          <div className="git-file-list-items">
            {files.map((file) => {
              const isSelected = selectedPaths.has(`${section}:${file.path}`);
              const lastSep = Math.max(
                file.path.lastIndexOf("/"),
                file.path.lastIndexOf("\\")
              );
              const fileName =
                lastSep === -1 ? file.path : file.path.slice(lastSep + 1);
              const dirPath =
                lastSep === -1 ? "" : file.path.slice(0, lastSep + 1);
              return (
                <div
                  key={`${section}-${file.path}`}
                  className={`git-file-item${isSelected ? " selected" : ""}`}
                  onClick={(e) => onFileSelect(file, e, section)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenu({ x: e.clientX, y: e.clientY, file });
                  }}
                  draggable
                  onDragStart={(event) => handleFileDragStart(event, file)}
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
                    <span className="git-file-name-text">{fileName}</span>
                    {dirPath && (
                      <span className="git-file-path">{dirPath}</span>
                    )}
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
                    disabled={actionInProgress !== null}
                    title={isStaged ? t("git.unstageFile") : t("git.stageFile")}
                  >
                    <span>{isStaged ? "-" : "+"}</span>
                  </button>
                  {!isStaged && onDiscard && (
                    <button
                      type="button"
                      className="git-file-action git-discard-action"
                      onClick={(e) => {
                        e.stopPropagation();
                        const filesToDiscard = isSelected
                          ? files.filter((f) =>
                              selectedPaths.has(`${section}:${f.path}`)
                            )
                          : [file];
                        onDiscard(filesToDiscard);
                      }}
                      disabled={actionInProgress !== null}
                      title={t("git.discardFile")}
                    >
                      <Undo2 size={12} strokeWidth={1.8} />
                    </button>
                  )}
                  {onOpenFile && (
                    <button
                      type="button"
                      className="git-file-action git-open-action"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenFile(file);
                      }}
                      disabled={actionInProgress !== null}
                      title={t("git.openFile")}
                    >
                      <FileText size={12} strokeWidth={1.8} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={buildMenuItems(contextMenu.file)}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
};
