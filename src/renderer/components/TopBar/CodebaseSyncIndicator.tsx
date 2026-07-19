import { Database, Loader2, RefreshCw } from "lucide-react";
import { useI18n } from "../../i18n";
import type { CodebaseSyncStatus } from "../../hooks/useCodebaseWatcher";

type CodebaseSyncIndicatorProps = {
  /** Current sync status from the codebase watcher hook. */
  syncStatus: CodebaseSyncStatus;
  /** The project id the status reflects. */
  watchedProjectId: string | undefined;
  /** The currently active project id (used to decide visibility). */
  activeProjectId: string | undefined;
};

/**
 * A compact indicator shown in the TopBar next to the codebase panel button.
 *
 * Visibility rules:
 * - Only shown when `watchedProjectId` matches `activeProjectId` (i.e. the
 *   watcher is active for the currently selected project).
 * - Hidden when `syncStatus` is `idle` (codebase disabled or no project).
 *
 * Visual states:
 * - `watching`: Database icon with a subtle green dot — index is up to date.
 * - `syncing`: Loader2 icon (spinning) with a blue dot — incremental sync
 *   in progress (embedding new/changed files, deleting removed files).
 */
export const CodebaseSyncIndicator = ({
  syncStatus,
  watchedProjectId,
  activeProjectId,
}: CodebaseSyncIndicatorProps): React.JSX.Element | null => {
  const { t } = useI18n();

  // Don't render if there's no active watcher or it's for a different project.
  if (!watchedProjectId || watchedProjectId !== activeProjectId) {
    return null;
  }

  if (syncStatus === "idle") {
    return null;
  }

  const isSyncing = syncStatus === "syncing";
  const label = isSyncing
    ? t("topBar.codebaseSync.syncing")
    : t("topBar.codebaseSync.watching");

  return (
    <button
      className={`icon-btn ghost top-bar-codebase-sync${
        isSyncing ? " is-syncing" : " is-watching"
      }`}
      type="button"
      aria-label={label}
      title={label}
      disabled
    >
      {isSyncing ? (
        <Loader2 size={14} strokeWidth={1.8} className="spin" />
      ) : (
        <Database size={14} strokeWidth={1.8} />
      )}
      <span className="top-bar-codebase-sync-dot" aria-hidden="true" />
    </button>
  );
};
