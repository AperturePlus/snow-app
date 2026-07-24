import { useCallback, useEffect, useRef, useState } from "react";

import type { CodebaseSyncProgress } from "../../preload/types/settings";

type UseCodebaseSyncParams = {
  projectId: string | undefined;
  /** When true (embedding is running/paused), sync progress is suppressed. */
  suppress: boolean;
  /** Called when a sync completes (done / no_changes) for the active project. */
  onSyncDone?: () => void;
};

type UseCodebaseSyncResult = {
  syncProgress: CodebaseSyncProgress | null;
  clearSyncProgress: () => void;
};

/**
 * Listens to codebase sync progress events scoped to a single project.
 *
 * The `onCodebaseSyncProgress` broadcast from the backend carries a
 * `projectId`. We only accept events whose `projectId` matches the current
 * project — events from other projects (e.g. a background sync on a previous
 * project) are silently dropped. When the project changes, `syncProgress` is
 * cleared immediately.
 *
 * The `suppress` flag is set by the caller when an explicit embedding is in
 * progress; in that case sync progress is hidden because the index is being
 * rebuilt by the user's action, not by the watcher.
 */
export const useCodebaseSync = ({
  projectId,
  suppress,
  onSyncDone,
}: UseCodebaseSyncParams): UseCodebaseSyncResult => {
  const [syncProgress, setSyncProgress] = useState<CodebaseSyncProgress | null>(
    null
  );

  // Keep the latest suppress flag and callback in refs so the event handler
  // (registered once per project) always reads fresh values without needing
  // to re-subscribe on every render.
  const suppressRef = useRef(suppress);
  const onDoneRef = useRef(onSyncDone);
  useEffect(() => {
    suppressRef.current = suppress;
  }, [suppress]);
  useEffect(() => {
    onDoneRef.current = onSyncDone;
  }, [onSyncDone]);

  // Reset when the active project changes.
  useEffect(() => {
    setSyncProgress(null);
  }, [projectId]);

  // Subscribe to sync progress events for the active project only.
  useEffect(() => {
    if (!projectId) {
      setSyncProgress(null);
      return;
    }

    const dispose = window.snow.onCodebaseSyncProgress(
      (progress, changedProjectId) => {
        // Strict project isolation: ignore events for other projects.
        if (changedProjectId !== projectId) {
          return;
        }

        // Don't show sync progress while an explicit embedding is running.
        if (suppressRef.current) {
          return;
        }

        // Terminal phases clear the display and refresh stats.
        if (
          progress.phase === "done" ||
          progress.phase === "no_changes" ||
          progress.phase === "error"
        ) {
          setSyncProgress(null);
          if (progress.phase === "done" || progress.phase === "no_changes") {
            onDoneRef.current?.();
          }
          return;
        }

        // Non-terminal phases update the display.
        setSyncProgress(progress);
      }
    );

    return () => {
      dispose();
    };
  }, [projectId]);

  // When suppression turns on (embedding started), clear any visible sync
  // progress so it doesn't linger behind the embedding UI.
  useEffect(() => {
    if (suppress) {
      setSyncProgress(null);
    }
  }, [suppress]);

  const clearSyncProgress = useCallback(() => {
    setSyncProgress(null);
  }, []);

  return {
    syncProgress,
    clearSyncProgress,
  };
};
