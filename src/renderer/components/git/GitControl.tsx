import {
  ArrowDownToLine,
  ArrowUpFromLine,
  GitCommitHorizontal,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GitFileStatus, GitStatusResult } from "../../../preload";
import { useGitStatus } from "./useGitStatus";
import { BranchSelector } from "./BranchSelector";
import { GitFileList } from "./GitFileList";

type GitControlProps = {
  repoPath: string | undefined | null;
  onFileSelect: (file: GitFileStatus | null) => void;
  selectedFile: GitFileStatus | null;
  onStatusChange?: (status: GitStatusResult | null) => void;
};

export const GitControl = ({
  repoPath,
  onFileSelect,
  selectedFile,
  onStatusChange,
}: GitControlProps): React.JSX.Element => {
  const { status, isLoading, error, refresh } = useGitStatus(repoPath);
  const [commitMessage, setCommitMessage] = useState("");
  const [actionInProgress, setActionInProgress] = useState(false);
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

  const handleStatusChange = useCallback(() => {
    refresh();
  }, [refresh]);

  const handleFileSelect = useCallback(
    (file: GitFileStatus) => {
      onFileSelect(file === selectedFile ? null : file);
    },
    [onFileSelect, selectedFile]
  );

  const handleStageToggle = useCallback(
    (file: GitFileStatus) => {
      if (!repoPath) {
        return;
      }

      const isStaged =
        file.indexStatus !== " " &&
        file.indexStatus !== "?" &&
        file.indexStatus !== "";

      setActionInProgress(true);
      if (isStaged) {
        window.snow
          .gitUnstage(repoPath, [file.path])
          .then(() => refresh())
          .finally(() => setActionInProgress(false));
      } else {
        window.snow
          .gitStage(repoPath, [file.path])
          .then(() => refresh())
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
      .then(() => refresh())
      .finally(() => setActionInProgress(false));
  }, [repoPath, refresh]);

  const handleUnstageAll = useCallback(() => {
    if (!repoPath) {
      return;
    }
    setActionInProgress(true);
    window.snow
      .gitUnstageAll(repoPath)
      .then(() => refresh())
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
        <div className="git-control-empty">No workspace directory selected</div>
      </div>
    );
  }

  if (isLoading && !status) {
    return (
      <div className="git-control">
        <div className="git-control-loading">Loading git status...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="git-control">
        <div className="git-control-error">{error}</div>
      </div>
    );
  }

  if (!status || !status.isRepo) {
    return (
      <div className="git-control">
        <div className="git-control-empty">Not a git repository</div>
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
            title="Pull"
          >
            <ArrowDownToLine size={14} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            className="icon-btn git-action-btn"
            onClick={handlePush}
            disabled={actionInProgress}
            title="Push"
          >
            <ArrowUpFromLine size={14} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      {(status.ahead > 0 || status.behind > 0) && (
        <div className="git-sync-status">
          {status.ahead > 0 && (
            <span className="git-sync-ahead">{status.ahead} ahead</span>
          )}
          {status.behind > 0 && (
            <span className="git-sync-behind">{status.behind} behind</span>
          )}
        </div>
      )}

      <GitFileList
        files={unstagedFiles}
        section="unstaged"
        onFileSelect={handleFileSelect}
        onStageToggle={handleStageToggle}
        onStageAll={handleStageAll}
        selectedPath={selectedFile?.path ?? null}
      />

      <GitFileList
        files={stagedFiles}
        section="staged"
        onFileSelect={handleFileSelect}
        onStageToggle={handleStageToggle}
        onUnstageAll={handleUnstageAll}
        selectedPath={selectedFile?.path ?? null}
      />

      <div className="git-commit-section">
        <textarea
          className="git-commit-input"
          placeholder="Commit message"
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
          <span>Commit</span>
        </button>
      </div>
    </div>
  );
};
