import {
  AlertCircle,
  BrainCircuit,
  Database,
  FileWarning,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  SearchCode,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CodebaseProjectScopeSettings } from "../../../../preload";
import type {
  CodebaseEmbedProgress,
  CodebaseIndexStats,
  CodebaseScanPreview,
  CodebaseSyncProgress,
  ResumableCodebaseSession,
} from "../../../../preload/types/settings";
import { useI18n } from "../../../i18n";
import { Modal } from "../../common/Modal";

type ProjectCodebasePanelProps = {
  open: boolean;
  projectId?: string;
  projectName?: string;
  onClose: () => void;
};

type ToggleKey = "enabled" | "enableAgentReview" | "enableReranking";

type EmbedState = "idle" | "running" | "paused" | "completed" | "error";

const createSessionId = (): string =>
  `embed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const formatElapsed = (ms: number): string => {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
};

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const ProjectCodebasePanel = ({
  open,
  projectId,
  projectName,
  onClose,
}: ProjectCodebasePanelProps): React.JSX.Element => {
  const { t } = useI18n();
  const [scope, setScope] = useState<CodebaseProjectScopeSettings | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<ToggleKey | null>(null);
  const [hasGitignore, setHasGitignore] = useState<boolean | null>(null);
  const [indexStats, setIndexStats] = useState<CodebaseIndexStats | null>(null);
  const [indexStatsLoaded, setIndexStatsLoaded] = useState(false);
  const [scanPreview, setScanPreview] = useState<CodebaseScanPreview | null>(
    null
  );
  const [isScanningPreview, setIsScanningPreview] = useState(false);
  const [embedState, setEmbedState] = useState<EmbedState>("idle");
  const [embedProgress, setEmbedProgress] =
    useState<CodebaseEmbedProgress | null>(null);
  const [resumableSession, setResumableSession] =
    useState<ResumableCodebaseSession | null>(null);
  const [isResuming, setIsResuming] = useState(false);
  const [syncProgress, setSyncProgress] = useState<CodebaseSyncProgress | null>(
    null
  );
  const sessionIdRef = useRef<string | null>(null);
  const loadGenerationRef = useRef(0);
  const pendingGenerationRef = useRef(0);

  const loadScope = useCallback(async (): Promise<void> => {
    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;
    pendingGenerationRef.current = generation;
    setPendingKey(null);
    setScope(null);
    setError(null);
    setHasGitignore(null);

    if (!projectId) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const [nextScope, nextHasGitignore] = await Promise.all([
        window.snow.getCodebaseProjectScopeSettings(projectId),
        window.snow.checkProjectHasGitignore(projectId),
      ]);
      if (loadGenerationRef.current === generation) {
        setScope(nextScope);
        setHasGitignore(nextHasGitignore);
      }
    } catch (loadError) {
      if (loadGenerationRef.current === generation) {
        setError(
          loadError instanceof Error ? loadError.message : String(loadError)
        );
      }
    } finally {
      if (loadGenerationRef.current === generation) {
        setIsLoading(false);
      }
    }
  }, [projectId]);

  const loadIndexStats = useCallback(async (): Promise<void> => {
    if (!projectId) {
      return;
    }
    try {
      const stats = await window.snow.getCodebaseIndexStats(projectId);
      setIndexStats(stats);
    } catch {
      setIndexStats(null);
    } finally {
      setIndexStatsLoaded(true);
    }
  }, [projectId]);

  const loadScanPreview = useCallback(async (): Promise<void> => {
    if (!projectId) {
      return;
    }
    setIsScanningPreview(true);
    try {
      const preview = await window.snow.previewCodebaseScan(projectId);
      setScanPreview(preview);
    } catch {
      setScanPreview(null);
    } finally {
      setIsScanningPreview(false);
    }
  }, [projectId]);

  const loadResumableSession = useCallback(async (): Promise<void> => {
    if (!projectId) {
      return;
    }
    try {
      const sessions = await window.snow.getResumableCodebaseSessions(
        projectId
      );
      // Only show the most recent resumable session; older ones are
      // discarded to keep the UI simple.
      setResumableSession(sessions.length > 0 ? sessions[0] : null);
    } catch {
      setResumableSession(null);
    }
  }, [projectId]);

  const handleResumeSession = useCallback(async (): Promise<void> => {
    const session = resumableSession;
    if (!session || !projectId) {
      return;
    }
    setIsResuming(true);
    setError(null);
    try {
      // Reuse the interrupted session id so the Rust side can update the
      // existing persisted record instead of creating a new one. The
      // embedding loop will skip files whose vectors are already stored
      // (insert_vectors deletes-and-reinserts per file_path, and files
      // that haven't changed since the last run are skipped by hash).
      sessionIdRef.current = session.sessionId;
      setEmbedState("running");
      setResumableSession(null);
      setScanPreview(null);

      await window.snow.startCodebaseEmbedding(
        projectId,
        session.sessionId,
        (progress: CodebaseEmbedProgress) => {
          setEmbedProgress(progress);
          if (progress.phase === "done") {
            setEmbedState("completed");
            setScanPreview(null);
          } else if (progress.phase === "error") {
            setEmbedState("error");
            if (progress.error) {
              setError(progress.error);
            }
          } else if (progress.phase === "cancelled") {
            setEmbedState("idle");
          } else if (progress.phase === "paused") {
            setEmbedState("paused");
          }
        }
      );
      void loadIndexStats();
    } catch (resumeError) {
      setEmbedState("error");
      setError(
        resumeError instanceof Error ? resumeError.message : String(resumeError)
      );
    } finally {
      setIsResuming(false);
    }
  }, [resumableSession, projectId, loadIndexStats]);

  const handleDiscardSession = useCallback(async (): Promise<void> => {
    const session = resumableSession;
    if (!session) {
      return;
    }
    try {
      await window.snow.discardResumableCodebaseSession(session.sessionId);
      setResumableSession(null);
    } catch (discardError) {
      setError(
        discardError instanceof Error
          ? discardError.message
          : String(discardError)
      );
    }
  }, [resumableSession]);

  const isEnabled = scope?.enabled ?? false;
  const isEmbedding = embedState === "running" || embedState === "paused";

  // Persistently listen to codebase sync progress events. The TopBar's
  // useCodebaseWatcher automatically triggers syncs (on watcher start for
  // offline changes, and on file-change events). This panel listens to the
  // broadcast sync progress to show real-time status.
  useEffect(() => {
    if (!projectId) {
      setSyncProgress(null);
      return;
    }

    const dispose = window.snow.onCodebaseSyncProgress(
      (progress, changedProjectId) => {
        // Only show progress for the currently active project.
        if (changedProjectId !== projectId) {
          return;
        }

        // Don't show sync progress while embedding — the index is being
        // rebuilt by the user's explicit embedding action.
        if (embedState === "running" || embedState === "paused") {
          return;
        }

        // Terminal phases clear the progress display.
        if (
          progress.phase === "done" ||
          progress.phase === "no_changes" ||
          progress.phase === "error"
        ) {
          setSyncProgress(null);
          // Refresh index stats after sync completes to reflect changes.
          if (progress.phase === "done" || progress.phase === "no_changes") {
            void loadIndexStats();
          }
          return;
        }

        // Non-terminal phases (scanning/deleting/embedding) update the display.
        setSyncProgress(progress);
      }
    );

    return () => {
      dispose();
    };
  }, [projectId, embedState, loadIndexStats]);

  // Reset sync progress when an embedding starts.
  useEffect(() => {
    if (embedState === "running") {
      setSyncProgress(null);
    }
  }, [embedState]);

  useEffect(() => {
    if (open) {
      // Clear any stale sync progress from a previous session when reopening.
      setSyncProgress(null);
      setIndexStatsLoaded(false);
      void loadScope();
      void loadIndexStats();
      void loadResumableSession();
      return;
    }

    // When closing the panel, reset scope-loading state and sync progress.
    // Embedding state (embedState, embedProgress, sessionIdRef) is preserved
    // so that the background embedding continues and progress callbacks keep
    // updating the UI. When the user reopens the panel, they see the current
    // embedding status instead of a stale "idle" state.
    setSyncProgress(null);
    loadGenerationRef.current += 1;
    pendingGenerationRef.current = loadGenerationRef.current;
    setPendingKey(null);
    setIsLoading(false);
  }, [loadScope, loadIndexStats, loadResumableSession, open]);

  // Auto-load scan preview when codebase is enabled and no index exists yet.
  // Wait for indexStats to load first so we don't trigger a preview scan
  // when the project is already indexed.
  useEffect(() => {
    if (
      open &&
      isEnabled &&
      !isEmbedding &&
      !scanPreview &&
      indexStatsLoaded &&
      !indexStats?.isIndexed
    ) {
      void loadScanPreview();
    }
  }, [
    open,
    isEnabled,
    isEmbedding,
    scanPreview,
    indexStatsLoaded,
    indexStats,
    loadScanPreview,
  ]);

  const toggle = async (key: ToggleKey, enabled: boolean): Promise<void> => {
    if (!projectId || pendingKey) {
      return;
    }

    const generation = loadGenerationRef.current;
    pendingGenerationRef.current = generation;
    setPendingKey(key);
    setError(null);
    setScope((current) => (current ? { ...current, [key]: enabled } : current));

    try {
      if (key === "enabled") {
        await window.snow.setCodebaseProjectEnabled(projectId, enabled);
      } else if (key === "enableAgentReview") {
        await window.snow.setCodebaseProjectAgentReview(projectId, enabled);
      } else {
        await window.snow.setCodebaseProjectReranking(projectId, enabled);
      }
    } catch (updateError) {
      if (loadGenerationRef.current === generation) {
        setScope((current) =>
          current ? { ...current, [key]: !enabled } : current
        );
        setError(
          updateError instanceof Error
            ? updateError.message
            : String(updateError)
        );
      }
    } finally {
      if (loadGenerationRef.current === generation) {
        setPendingKey(null);
      }
    }
  };

  const handleStartEmbedding = useCallback(async (): Promise<void> => {
    if (!projectId || embedState === "running") {
      return;
    }

    const sessionId = createSessionId();
    sessionIdRef.current = sessionId;
    setEmbedState("running");
    setEmbedProgress(null);
    setError(null);
    // Clear the preview once embedding starts — it's no longer relevant.
    setScanPreview(null);

    try {
      await window.snow.startCodebaseEmbedding(
        projectId,
        sessionId,
        (progress: CodebaseEmbedProgress) => {
          setEmbedProgress(progress);
          if (progress.phase === "done") {
            setEmbedState("completed");
            // Clear the preview — the actual index stats replace it.
            setScanPreview(null);
          } else if (progress.phase === "error") {
            setEmbedState("error");
            if (progress.error) {
              setError(progress.error);
            }
          } else if (progress.phase === "cancelled") {
            setEmbedState("idle");
          } else if (progress.phase === "paused") {
            setEmbedState("paused");
          }
        }
      );
      // Reload stats after completion
      void loadIndexStats();
    } catch (embedError) {
      setEmbedState("error");
      setError(
        embedError instanceof Error ? embedError.message : String(embedError)
      );
    }
  }, [projectId, embedState, loadIndexStats]);

  const handlePauseEmbedding = useCallback(async (): Promise<void> => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) {
      return;
    }
    try {
      await window.snow.pauseCodebaseEmbedding(sessionId);
      setEmbedState("paused");
    } catch (pauseError) {
      setError(
        pauseError instanceof Error ? pauseError.message : String(pauseError)
      );
    }
  }, []);

  const handleResumeEmbedding = useCallback(async (): Promise<void> => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) {
      return;
    }
    try {
      await window.snow.resumeCodebaseEmbedding(sessionId);
      setEmbedState("running");
    } catch (resumeError) {
      setError(
        resumeError instanceof Error ? resumeError.message : String(resumeError)
      );
    }
  }, []);

  const handleCancelEmbedding = useCallback(async (): Promise<void> => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) {
      return;
    }
    try {
      await window.snow.cancelCodebaseEmbedding(sessionId);
      setEmbedState("idle");
      setEmbedProgress(null);
      sessionIdRef.current = null;
    } catch (cancelError) {
      setError(
        cancelError instanceof Error ? cancelError.message : String(cancelError)
      );
    }
  }, []);

  const handleClearIndex = useCallback(async (): Promise<void> => {
    if (!projectId) {
      return;
    }
    try {
      await window.snow.clearCodebaseIndex(projectId);
      setIndexStats(null);
      setIndexStatsLoaded(false);
      setEmbedState("idle");
      setEmbedProgress(null);
      // Clear preview so it auto-reloads after clearing the index.
      setScanPreview(null);
      // Reload stats to update indexStatsLoaded.
      void loadIndexStats();
    } catch (clearError) {
      setError(
        clearError instanceof Error ? clearError.message : String(clearError)
      );
    }
  }, [projectId, loadIndexStats]);

  const renderToggle = (
    key: ToggleKey,
    label: string,
    description: string
  ): React.JSX.Element => {
    const checked = scope?.[key] ?? false;
    const isPending = pendingKey === key;

    return (
      <article
        className={`project-sensitive-command-row${
          checked ? " is-enabled" : ""
        }`}
      >
        <SearchCode size={15} />
        <div className="project-sensitive-command-content">
          <div>
            <code>{label}</code>
          </div>
          <span>{description}</span>
        </div>
        <label
          className="project-sensitive-command-switch"
          title={
            checked
              ? t("projectCodebase.disableForProject")
              : t("projectCodebase.enableForProject")
          }
        >
          <input
            aria-label={
              checked
                ? t("projectCodebase.disableForProject")
                : t("projectCodebase.enableForProject")
            }
            checked={checked}
            disabled={isPending}
            onChange={(event) => void toggle(key, event.target.checked)}
            type="checkbox"
          />
          <span aria-hidden="true" />
        </label>
      </article>
    );
  };

  const progressPercent =
    embedProgress && embedProgress.totalChunks > 0
      ? Math.round(
          (embedProgress.processedChunks / embedProgress.totalChunks) * 100
        )
      : 0;

  const phaseLabel = embedProgress
    ? t(`projectCodebase.phase.${embedProgress.phase}`)
    : "";

  return (
    <Modal
      className="project-sensitive-command-modal project-codebase-modal"
      closeLabel={t("projectCodebase.close")}
      description={
        projectId
          ? t("projectCodebase.description", {
              values: { project: projectName || projectId },
            })
          : t("projectCodebase.noProject")
      }
      onClose={onClose}
      open={open}
      size="large"
      title={t("projectCodebase.title")}
    >
      {!projectId ? (
        <div className="project-sensitive-command-state">
          <AlertCircle size={18} />
          <span>{t("projectCodebase.noProject")}</span>
        </div>
      ) : isLoading && !scope ? (
        <div className="project-sensitive-command-state">
          <Loader2 className="spin" size={18} />
          <span>{t("projectCodebase.loading")}</span>
        </div>
      ) : hasGitignore === false ? (
        <div className="project-sensitive-command-state project-codebase-gitignore-warning">
          <FileWarning size={18} />
          <span>{t("projectCodebase.gitignoreMissing")}</span>
        </div>
      ) : (
        <>
          <div className="project-sensitive-command-toolbar">
            <div>
              <span>{t("projectCodebase.scopeNote")}</span>
            </div>
            <div>
              <button
                className="project-sensitive-command-toolbar-btn"
                disabled={isLoading || pendingKey !== null || isEmbedding}
                onClick={() => {
                  void loadScope();
                  void loadIndexStats();
                }}
                type="button"
              >
                <RefreshCw className={isLoading ? "spin" : ""} size={14} />
                <span>{t("projectCodebase.refresh")}</span>
              </button>
            </div>
          </div>

          {error ? (
            <div className="project-sensitive-command-error">
              <AlertCircle size={15} />
              <span>{error}</span>
            </div>
          ) : null}

          <div className="project-sensitive-command-groups project-codebase-list">
            {renderToggle(
              "enabled",
              t("projectCodebase.toggleEnabled"),
              t("projectCodebase.toggleEnabledDescription")
            )}
            {renderToggle(
              "enableAgentReview",
              t("projectCodebase.toggleAgentReview"),
              t("projectCodebase.toggleAgentReviewDescription")
            )}
            {renderToggle(
              "enableReranking",
              t("projectCodebase.toggleReranking"),
              t("projectCodebase.toggleRerankingDescription")
            )}
          </div>

          {isEnabled ? (
            <div className="project-codebase-embedding-section">
              <div className="project-codebase-embedding-header">
                <Database size={15} />
                <div>
                  <strong>{t("projectCodebase.embedding.title")}</strong>
                  <span>{t("projectCodebase.embedding.description")}</span>
                </div>
              </div>

              {syncProgress && !isEmbedding ? (
                <div className="project-codebase-files-changed-hint">
                  <Loader2 size={14} className="spin" />
                  <span>{t("projectCodebase.syncing")}</span>
                </div>
              ) : null}

              {resumableSession && !isEmbedding ? (
                <div className="project-codebase-resumable-session">
                  <div className="project-codebase-resumable-info">
                    <RotateCcw size={15} />
                    <div>
                      <strong>
                        {t("projectCodebase.resume.title")}
                        <span className="project-codebase-resumable-status">
                          {resumableSession.status === "paused"
                            ? t("projectCodebase.resume.statusPaused")
                            : t("projectCodebase.resume.statusInterrupted")}
                        </span>
                      </strong>
                      <span>{t("projectCodebase.resume.description")}</span>
                      {resumableSession.totalFiles > 0 ? (
                        <span className="project-codebase-resumable-progress">
                          {t("projectCodebase.resume.progress", {
                            values: {
                              processed: resumableSession.processedFiles,
                              total: resumableSession.totalFiles,
                              chunks: resumableSession.processedChunks,
                            },
                          })}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="project-codebase-resumable-actions">
                    <button
                      className="project-codebase-embed-btn primary"
                      disabled={isResuming}
                      onClick={() => void handleResumeSession()}
                      type="button"
                    >
                      {isResuming ? (
                        <Loader2 className="spin" size={14} />
                      ) : (
                        <Play size={14} />
                      )}
                      <span>{t("projectCodebase.resume.resume")}</span>
                    </button>
                    <button
                      className="project-codebase-embed-btn"
                      disabled={isResuming}
                      onClick={() => void handleDiscardSession()}
                      type="button"
                    >
                      <X size={14} />
                      <span>{t("projectCodebase.resume.discard")}</span>
                    </button>
                  </div>
                </div>
              ) : null}

              {embedState === "completed" && indexStats ? (
                <div className="project-codebase-index-stats">
                  <div className="project-codebase-stat-item">
                    <span className="project-codebase-stat-label">
                      {t("projectCodebase.stats.files")}
                    </span>
                    <span className="project-codebase-stat-value">
                      {indexStats.totalFiles}
                    </span>
                  </div>
                  <div className="project-codebase-stat-item">
                    <span className="project-codebase-stat-label">
                      {t("projectCodebase.stats.chunks")}
                    </span>
                    <span className="project-codebase-stat-value">
                      {indexStats.totalChunks}
                    </span>
                  </div>
                  <div className="project-codebase-stat-item">
                    <span className="project-codebase-stat-label">
                      {t("projectCodebase.stats.size")}
                    </span>
                    <span className="project-codebase-stat-value">
                      {formatBytes(indexStats.totalSizeBytes)}
                    </span>
                  </div>
                </div>
              ) : null}

              {scanPreview && !indexStats?.isIndexed && !isEmbedding ? (
                <div className="project-codebase-scan-preview">
                  <div className="project-codebase-stat-item">
                    <span className="project-codebase-stat-label">
                      {t("projectCodebase.preview.files")}
                    </span>
                    <span className="project-codebase-stat-value">
                      {scanPreview.fileCount}
                    </span>
                  </div>
                  <div className="project-codebase-stat-item">
                    <span className="project-codebase-stat-label">
                      {t("projectCodebase.preview.chunks")}
                    </span>
                    <span className="project-codebase-stat-value">
                      {scanPreview.estimatedChunks}
                    </span>
                  </div>
                  <div className="project-codebase-stat-item">
                    <span className="project-codebase-stat-label">
                      {t("projectCodebase.preview.size")}
                    </span>
                    <span className="project-codebase-stat-value">
                      {formatBytes(scanPreview.totalSizeBytes)}
                    </span>
                  </div>
                </div>
              ) : isScanningPreview &&
                !indexStats?.isIndexed &&
                !isEmbedding ? (
                <div className="project-codebase-scan-preview">
                  <Loader2 className="spin" size={14} />
                  <span>{t("projectCodebase.preview.scanning")}</span>
                </div>
              ) : null}

              {embedProgress ? (
                <div className="project-codebase-embed-progress">
                  <div className="project-codebase-embed-progress-info">
                    <span className="project-codebase-embed-phase">
                      {phaseLabel}
                    </span>
                    {embedProgress.currentFile ? (
                      <span
                        className="project-codebase-embed-file"
                        title={embedProgress.currentFile}
                      >
                        {embedProgress.currentFile}
                      </span>
                    ) : null}
                    <span className="project-codebase-embed-counts">
                      {embedProgress.processedChunks} /{" "}
                      {embedProgress.totalChunks}
                      {embedProgress.totalFiles > 0
                        ? ` (${embedProgress.processedFiles}/${embedProgress.totalFiles})`
                        : ""}
                    </span>
                    {embedProgress.elapsedMs > 0 ? (
                      <span className="project-codebase-embed-elapsed">
                        {formatElapsed(embedProgress.elapsedMs)}
                      </span>
                    ) : null}
                  </div>
                  <div className="project-codebase-embed-progress-bar">
                    <div
                      className="project-codebase-embed-progress-fill"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                </div>
              ) : null}

              <div className="project-codebase-embed-actions">
                {(embedState === "idle" || embedState === "completed") &&
                !resumableSession ? (
                  <button
                    className="project-codebase-embed-btn primary"
                    disabled={isEmbedding}
                    onClick={() => void handleStartEmbedding()}
                    type="button"
                  >
                    <Play size={14} />
                    <span>
                      {embedState === "completed"
                        ? t("projectCodebase.embedding.reindex")
                        : t("projectCodebase.embedding.start")}
                    </span>
                  </button>
                ) : null}
                {embedState === "running" ? (
                  <button
                    className="project-codebase-embed-btn"
                    onClick={() => void handlePauseEmbedding()}
                    type="button"
                  >
                    <Pause size={14} />
                    <span>{t("projectCodebase.embedding.pause")}</span>
                  </button>
                ) : null}
                {embedState === "paused" ? (
                  <button
                    className="project-codebase-embed-btn primary"
                    onClick={() => void handleResumeEmbedding()}
                    type="button"
                  >
                    <Play size={14} />
                    <span>{t("projectCodebase.embedding.resume")}</span>
                  </button>
                ) : null}
                {isEmbedding ? (
                  <button
                    className="project-codebase-embed-btn danger"
                    onClick={() => void handleCancelEmbedding()}
                    type="button"
                  >
                    <Square size={14} />
                    <span>{t("projectCodebase.embedding.cancel")}</span>
                  </button>
                ) : null}
                {indexStats &&
                indexStats.isIndexed &&
                !isEmbedding &&
                !resumableSession ? (
                  <button
                    className="project-codebase-embed-btn danger"
                    onClick={() => void handleClearIndex()}
                    type="button"
                  >
                    <Trash2 size={14} />
                    <span>{t("projectCodebase.embedding.clear")}</span>
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="project-codebase-config-hint">
            <BrainCircuit size={14} />
            <span>{t("projectCodebase.configHint")}</span>
          </div>
        </>
      )}
    </Modal>
  );
};
