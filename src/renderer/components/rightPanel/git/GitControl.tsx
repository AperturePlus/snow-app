import {
  ArrowDownToLine,
  ArrowUpFromLine,
  GitCommitHorizontal,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GitFileStatus, GitStatusResult } from "../../../../preload";
import { useI18n } from "../../../i18n";
import { useGitStatus } from "./useGitStatus";
import { BranchSelector } from "./BranchSelector";
import { GitFileList } from "./GitFileList";

type GitControlProps = {
  repoPath: string | undefined | null;
  onFileSelect: (file: GitFileStatus | null) => void;
  onStatusChange?: (status: GitStatusResult | null) => void;
};

const isSelectedKey = (section: "staged" | "unstaged", path: string) =>
  `${section}:${path}`;

export const GitControl = ({
  repoPath,
  onFileSelect,
  onStatusChange,
}: GitControlProps): React.JSX.Element => {
  const { t } = useI18n();
  const { status, isLoading, error, refresh } = useGitStatus(repoPath);
  const [commitMessage, setCommitMessage] = useState("");
  const [actionInProgress, setActionInProgress] = useState(false);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const lastClickedPathRef = useRef<string | null>(null);
  const lastClickedSectionRef = useRef<"staged" | "unstaged" | null>(null);
  const prevStatusRef = useRef<string | null>(null);

  // Propagate status changes upward via ref to avoid render-cycle side effects
  useEffect(() => {
    if (!onStatusChange) {
      return;
    }
    const serialized = status ? JSON.stringify(status) : null;
    if (serialized !== prevStatusRef.current) {
      prevStatusRef.current = serialized;
      onStatusChange(status);
    }
  }, [status, onStatusChange]);

  // Prune selectedPaths that are no longer present in the current status.
  // Keys are stored as "section:path" composite keys.
  useEffect(() => {
    if (!status) {
      return;
    }
    const stagedPaths = new Set(
      status.files
        .filter(
          (f) =>
            f.indexStatus !== " " &&
            f.indexStatus !== "?" &&
            f.indexStatus !== ""
        )
        .map((f) => f.path)
    );
    const unstagedPaths = new Set(
      status.files
        .filter(
          (f) =>
            f.workdirStatus === "?" ||
            (f.workdirStatus !== " " && f.workdirStatus !== "")
        )
        .map((f) => f.path)
    );
    setSelectedPaths((prev) => {
      if (prev.size === 0) {
        return prev;
      }
      let changed = false;
      const next = new Set<string>();
      for (const key of prev) {
        const colonIdx = key.indexOf(":");
        if (colonIdx === -1) {
          changed = true;
          continue;
        }
        const sec = key.slice(0, colonIdx);
        const path = key.slice(colonIdx + 1);
        const valid =
          (sec === "staged" && stagedPaths.has(path)) ||
          (sec === "unstaged" && unstagedPaths.has(path));
        if (valid) {
          next.add(key);
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [status]);

  const handleStatusChange = useCallback(() => {
    refresh();
  }, [refresh]);

  const handleFileSelect = useCallback(
    (
      file: GitFileStatus,
      e: React.MouseEvent,
      section: "staged" | "unstaged"
    ) => {
      const isMulti = e.metaKey || e.ctrlKey;
      const isRange = e.shiftKey;
      const fileLists = status?.files ?? [];
      const key = isSelectedKey(section, file.path);

      setSelectedPaths((prev) => {
        const next = new Set(prev);

        if (isRange && lastClickedPathRef.current !== null) {
          // Range select: select all files between last clicked and current.
          // Only operate within the same section to avoid cross-section leakage.
          const lastKey = lastClickedPathRef.current;
          const sameSection = lastClickedSectionRef.current === section;
          const lastKeyPath = lastKey.includes(":")
            ? lastKey.slice(lastKey.indexOf(":") + 1)
            : lastKey;
          const sectionFiles = fileLists.filter((f) =>
            section === "staged"
              ? f.indexStatus !== " " &&
                f.indexStatus !== "?" &&
                f.indexStatus !== ""
              : f.workdirStatus === "?" ||
                (f.workdirStatus !== " " && f.workdirStatus !== "")
          );
          const lastIndex = sameSection
            ? sectionFiles.findIndex((f) => f.path === lastKeyPath)
            : -1;
          const currentIndex = sectionFiles.findIndex(
            (f) => f.path === file.path
          );
          if (lastIndex !== -1 && currentIndex !== -1) {
            const start = Math.min(lastIndex, currentIndex);
            const end = Math.max(lastIndex, currentIndex);
            // If not multi-selecting, clear previous selection first
            if (!isMulti) {
              next.clear();
            }
            for (let i = start; i <= end; i++) {
              next.add(isSelectedKey(section, sectionFiles[i].path));
            }
          } else if (!isMulti) {
            next.clear();
            next.add(key);
          } else {
            next.add(key);
          }
          lastClickedPathRef.current = key;
          lastClickedSectionRef.current = section;
          return next;
        }

        if (isMulti) {
          if (next.has(key)) {
            next.delete(key);
          } else {
            next.add(key);
          }
        } else {
          next.clear();
          next.add(key);
        }

        lastClickedPathRef.current = key;
        lastClickedSectionRef.current = section;
        return next;
      });

      // Notify parent for diff display - send the clicked file
      onFileSelect(file);
    },
    [status, onFileSelect]
  );

  const handleStageToggle = useCallback(
    (files: GitFileStatus[], section: "staged" | "unstaged") => {
      if (!repoPath || files.length === 0) {
        return;
      }

      const isStaged = section === "staged";
      const paths = files.map((f) => f.path);

      setActionInProgress(true);
      if (isStaged) {
        window.snow
          .gitUnstage(repoPath, paths)
          .then((result) => {
            if (result.success) {
              setSelectedPaths(new Set());
              refresh();
            }
          })
          .finally(() => setActionInProgress(false));
      } else {
        window.snow
          .gitStage(repoPath, paths)
          .then((result) => {
            if (result.success) {
              setSelectedPaths(new Set());
              refresh();
            }
          })
          .finally(() => setActionInProgress(false));
      }
    },
    [repoPath, refresh]
  );

  const handleStageAll = useCallback(() => {
    if (!repoPath) {
      return;
    }
    setActionInProgress(true);
    window.snow
      .gitStageAll(repoPath)
      .then(() => {
        setSelectedPaths(new Set());
        refresh();
      })
      .finally(() => setActionInProgress(false));
  }, [repoPath, refresh]);

  const handleUnstageAll = useCallback(() => {
    if (!repoPath) {
      return;
    }
    setActionInProgress(true);
    window.snow
      .gitUnstageAll(repoPath)
      .then(() => {
        setSelectedPaths(new Set());
        refresh();
      })
      .finally(() => setActionInProgress(false));
  }, [repoPath, refresh]);

  const handleCommit = useCallback(() => {
    if (!repoPath || !commitMessage.trim()) {
      return;
    }
    setActionInProgress(true);
    window.snow
      .gitCommit(repoPath, commitMessage)
      .then(() => {
        setCommitMessage("");
        refresh();
      })
      .finally(() => setActionInProgress(false));
  }, [repoPath, commitMessage, refresh]);

  const handlePush = useCallback(() => {
    if (!repoPath) {
      return;
    }
    setActionInProgress(true);
    window.snow
      .gitPush(repoPath)
      .then(() => refresh())
      .finally(() => setActionInProgress(false));
  }, [repoPath, refresh]);

  const handlePull = useCallback(() => {
    if (!repoPath) {
      return;
    }
    setActionInProgress(true);
    window.snow
      .gitPull(repoPath)
      .then(() => refresh())
      .finally(() => setActionInProgress(false));
  }, [repoPath, refresh]);

  if (!repoPath) {
    return (
      <div className="git-control">
        <div className="git-control-empty">{t("git.noWorkspaceDirectory")}</div>
      </div>
    );
  }

  if (isLoading && !status) {
    return (
      <div className="git-control">
        <div className="git-control-loading">{t("git.loadingStatus")}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="git-control">
        <div className="git-control-error">{t(error)}</div>
      </div>
    );
  }

  if (!status || !status.isRepo) {
    return (
      <div className="git-control">
        <div className="git-control-empty">{t("git.notARepo")}</div>
      </div>
    );
  }

  const stagedFiles = status.files.filter(
    (f) =>
      f.indexStatus !== " " && f.indexStatus !== "?" && f.indexStatus !== ""
  );
  const unstagedFiles = status.files.filter(
    (f) =>
      f.workdirStatus === "?" ||
      (f.workdirStatus !== " " && f.workdirStatus !== "")
  );

  return (
    <div className="git-control">
      <div className="git-control-header">
        <BranchSelector
          repoPath={repoPath}
          currentBranch={status.currentBranch}
          onBranchChanged={handleStatusChange}
        />
        <div className="git-control-actions">
          <button
            type="button"
            className="icon-btn git-action-btn"
            onClick={handlePull}
            disabled={actionInProgress}
            title={t("git.pull")}
          >
            <ArrowDownToLine size={14} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            className="icon-btn git-action-btn"
            onClick={handlePush}
            disabled={actionInProgress}
            title={t("git.push")}
          >
            <ArrowUpFromLine size={14} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      {(status.ahead > 0 || status.behind > 0) && (
        <div className="git-sync-status">
          {status.ahead > 0 && (
            <span className="git-sync-ahead">
              {t("git.ahead", { values: { count: status.ahead } })}
            </span>
          )}
          {status.behind > 0 && (
            <span className="git-sync-behind">
              {t("git.behind", { values: { count: status.behind } })}
            </span>
          )}
        </div>
      )}

      <GitFileList
        files={unstagedFiles}
        section="unstaged"
        selectedPaths={selectedPaths}
        actionInProgress={actionInProgress}
        onFileSelect={handleFileSelect}
        onStageToggle={handleStageToggle}
        onStageAll={handleStageAll}
      />

      <GitFileList
        files={stagedFiles}
        section="staged"
        selectedPaths={selectedPaths}
        actionInProgress={actionInProgress}
        onFileSelect={handleFileSelect}
        onStageToggle={handleStageToggle}
        onUnstageAll={handleUnstageAll}
      />

      <div className="git-commit-section">
        <textarea
          className="git-commit-input"
          placeholder={t("git.commitMessagePlaceholder")}
          value={commitMessage}
          onChange={(e) => setCommitMessage(e.target.value)}
          rows={2}
        />
        <button
          type="button"
          className="git-commit-btn"
          onClick={handleCommit}
          disabled={
            actionInProgress ||
            !commitMessage.trim() ||
            stagedFiles.length === 0
          }
        >
          <GitCommitHorizontal size={14} strokeWidth={1.8} />
          <span>{t("git.commit")}</span>
        </button>
      </div>
    </div>
  );
};
