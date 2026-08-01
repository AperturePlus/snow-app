import {
  ChevronLeft,
  ChevronRight,
  Database,
  Loader2,
  Orbit,
  Table2,
} from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";

import { useI18n } from "../../i18n";
import type { CodebaseIndexedFilePage } from "../../../preload";

const PAGE_SIZE = 20;

// three.js 体积较大，按需加载，避免打入首屏 chunk。
const CodebaseSphereView = lazy(() =>
  import("./CodebaseSphereView").then((m) => ({
    default: m.CodebaseSphereView,
  }))
);

type CodebaseViewMode = "table" | "sphere";

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatUpdatedAt = (value: string): string => {
  // SQLite stores "YYYY-MM-DD HH:MM:SS"; keep the date part only.
  return value ? value.slice(0, 10) : "-";
};

type CodebasePanelContentProps = {
  /** The project (workspace directory) id whose index should be shown. */
  projectId: string;
  /** Display name of the project, used as fallback heading. */
  projectName: string;
};

/**
 * Codebase index viewer for the active project, with two views:
 * - `table`: paginated file list.
 * - `sphere`: 3D similarity sphere (each point is a file, distances are
 *   derived from real embedding similarity).
 * Reloads automatically when `projectId` changes (project switch).
 */
export const CodebasePanelContent = ({
  projectId,
  projectName,
}: CodebasePanelContentProps): React.JSX.Element => {
  const { t } = useI18n();
  const [viewMode, setViewMode] = useState<CodebaseViewMode>("table");
  const [data, setData] = useState<CodebaseIndexedFilePage | null>(null);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  // Reset to the first page whenever the project changes.
  useEffect(() => {
    setPage(1);
    setData(null);
    setHasError(false);
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;

    setIsLoading(true);
    setHasError(false);

    void window.snow
      .listCodebaseIndexedFiles(projectId, page, PAGE_SIZE)
      .then((result) => {
        if (!cancelled) {
          setData(result);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHasError(true);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, page]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  const handlePrevPage = (): void => {
    setPage((current) => Math.max(1, current - 1));
  };

  const handleNextPage = (): void => {
    setPage((current) => Math.min(totalPages, current + 1));
  };

  const isEmpty = !isLoading && !hasError && (data?.items.length ?? 0) === 0;

  return (
    <div className="codebase-panel">
      <div className="codebase-panel-header">
        <Database size={13} strokeWidth={1.8} />
        <span className="codebase-panel-title" title={projectName}>
          {projectName}
        </span>
        {viewMode === "table" && data && data.total > 0 && (
          <span className="codebase-panel-count">
            {t("codebase.panel.fileCount", { values: { count: data.total } })}
          </span>
        )}
        <div className="codebase-panel-view-toggle" role="group">
          <button
            type="button"
            className={`codebase-panel-view-btn${
              viewMode === "table" ? " active" : ""
            }`}
            onClick={() => setViewMode("table")}
            aria-label={t("codebase.panel.viewTable")}
            title={t("codebase.panel.viewTable")}
          >
            <Table2 size={13} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            className={`codebase-panel-view-btn${
              viewMode === "sphere" ? " active" : ""
            }`}
            onClick={() => setViewMode("sphere")}
            aria-label={t("codebase.panel.viewSphere")}
            title={t("codebase.panel.viewSphere")}
          >
            <Orbit size={13} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      {viewMode === "sphere" ? (
        <Suspense fallback={null}>
          <CodebaseSphereView projectId={projectId} />
        </Suspense>
      ) : isLoading ? (
        <div className="codebase-panel-state">
          <Loader2 size={18} strokeWidth={1.8} className="spin" />
        </div>
      ) : hasError ? (
        <div className="codebase-panel-state codebase-panel-error">
          {t("codebase.panel.loadError")}
        </div>
      ) : isEmpty ? (
        <div className="codebase-panel-state">
          {t("codebase.panel.empty")}
        </div>
      ) : (
        <>
          <div className="codebase-panel-table-wrap">
            <table className="codebase-panel-table">
              <thead>
                <tr>
                  <th>{t("codebase.panel.colPath")}</th>
                  <th>{t("codebase.panel.colChunks")}</th>
                  <th>{t("codebase.panel.colLines")}</th>
                  <th>{t("codebase.panel.colSize")}</th>
                  <th>{t("codebase.panel.colUpdated")}</th>
                </tr>
              </thead>
              <tbody>
                {data?.items.map((file) => (
                  <tr key={file.filePath} title={file.filePath}>
                    <td className="codebase-panel-path">{file.relativePath}</td>
                    <td className="codebase-panel-num">{file.chunkCount}</td>
                    <td className="codebase-panel-num">
                      {file.startLine > 0 && file.endLine > 0
                        ? `${file.startLine} - ${file.endLine}`
                        : "-"}
                    </td>
                    <td className="codebase-panel-num">
                      {formatBytes(file.sizeBytes)}
                    </td>
                    <td className="codebase-panel-date">
                      {formatUpdatedAt(file.updatedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="codebase-panel-pagination">
              <button
                type="button"
                className="codebase-panel-page-btn"
                onClick={handlePrevPage}
                disabled={page <= 1}
                aria-label={t("codebase.panel.prevPage")}
              >
                <ChevronLeft size={14} strokeWidth={1.8} />
              </button>
              <span className="codebase-panel-page-info">
                {t("codebase.panel.pageInfo", {
                  values: { page, total: totalPages },
                })}
              </span>
              <button
                type="button"
                className="codebase-panel-page-btn"
                onClick={handleNextPage}
                disabled={page >= totalPages}
                aria-label={t("codebase.panel.nextPage")}
              >
                <ChevronRight size={14} strokeWidth={1.8} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};
