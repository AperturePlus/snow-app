import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GitCommitFile, GitLogEntry } from "../../../../preload";
import { useI18n } from "../../../i18n";

type GitGraphProps = {
  repoPath: string;
};

// --- Types ---

interface GraphRow {
  commit: GitLogEntry;
  dotLane: number;
  topLines: number[];
  bottomLines: number[];
  curves: { from: number; to: number }[];
}

// --- Constants ---

const PAGE_SIZE = 50;
const LANE_WIDTH = 20;
const ROW_HEIGHT = 28;
const DOT_RADIUS = 4;
const LINE_WIDTH = 2;

const LANE_COLORS = [
  "#3b82f6",
  "#ef4444",
  "#22c55e",
  "#a855f7",
  "#f59e0b",
  "#06b6d4",
  "#ec4899",
  "#14b8a6",
];

// --- Lane computation ---

function computeGraph(commits: GitLogEntry[]): {
  rows: GraphRow[];
  maxLanes: number;
} {
  const hashToLane = new Map<string, number>();
  const lanes: (string | null)[] = [];
  const rows: GraphRow[] = [];

  for (const commit of commits) {
    let dotLane: number;
    if (hashToLane.has(commit.hash)) {
      dotLane = hashToLane.get(commit.hash)!;
      hashToLane.delete(commit.hash);
    } else {
      const freeLane = lanes.indexOf(null);
      dotLane = freeLane !== -1 ? freeLane : lanes.length;
      if (dotLane >= lanes.length) {
        lanes.push(null);
      }
    }

    const topLines: number[] = [];
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] !== null) {
        topLines.push(i);
      }
    }

    lanes[dotLane] = null;

    const curves: { from: number; to: number }[] = [];

    for (let p = 0; p < commit.parents.length; p++) {
      const parentHash = commit.parents[p];
      const isFirstParent = p === 0;

      let parentLane: number;
      if (hashToLane.has(parentHash)) {
        parentLane = hashToLane.get(parentHash)!;
      } else {
        if (isFirstParent) {
          parentLane = dotLane;
        } else {
          const freeLane = lanes.indexOf(null);
          parentLane = freeLane !== -1 ? freeLane : lanes.length;
          if (parentLane >= lanes.length) {
            lanes.push(null);
          }
        }
        hashToLane.set(parentHash, parentLane);
      }

      lanes[parentLane] = parentHash;

      if (parentLane !== dotLane) {
        curves.push({ from: dotLane, to: parentLane });
      }
    }

    const bottomLines: number[] = [];
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] !== null) {
        bottomLines.push(i);
      }
    }

    rows.push({ commit, dotLane, topLines, bottomLines, curves });
  }

  return { rows, maxLanes: lanes.length };
}

// --- Helpers ---

function formatDate(dateStr: string): string {
  return dateStr.split(" ")[0];
}

function getCommitFileColor(status: string): string {
  if (status.startsWith("A")) return "git-status-add";
  if (status.startsWith("D")) return "git-status-delete";
  if (status.startsWith("R")) return "git-status-rename";
  return "git-status-modify";
}

function getCommitFileLabel(status: string): string {
  if (status.startsWith("A")) return "A";
  if (status.startsWith("D")) return "D";
  if (status.startsWith("R")) return "R";
  if (status.startsWith("C")) return "C";
  if (status.startsWith("M")) return "M";
  return status.charAt(0);
}

// --- Component ---

export const GitGraph = ({ repoPath }: GitGraphProps): React.JSX.Element => {
  const { t } = useI18n();
  const [commits, setCommits] = useState<GitLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [commitFiles, setCommitFiles] = useState<GitCommitFile[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);

  const loadingRef = useRef(false);
  const loadedCountRef = useRef(0);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const loadPage = useCallback(
    async (skip: number, isInitial: boolean) => {
      if (loadingRef.current) return;
      loadingRef.current = true;

      try {
        const entries = await window.snow.gitLog(repoPath, skip, PAGE_SIZE);
        if (entries.length < PAGE_SIZE) {
          setHasMore(false);
        }
        if (entries.length > 0) {
          if (isInitial) {
            setCommits(entries);
          } else {
            setCommits((prev) => [...prev, ...entries]);
          }
          loadedCountRef.current = skip + entries.length;
        } else {
          setHasMore(false);
        }
      } catch (err) {
        setError(String(err));
        setHasMore(false);
      } finally {
        loadingRef.current = false;
        setIsLoading(false);
      }
    },
    [repoPath]
  );

  // Initial load + reset when repoPath changes.
  // Uses a cancelled flag to survive React Strict Mode double-invoke.
  useEffect(() => {
    let cancelled = false;

    setCommits([]);
    setHasMore(true);
    setError(null);
    setIsLoading(true);
    setSelectedHash(null);
    setCommitFiles([]);
    loadedCountRef.current = 0;
    loadingRef.current = false;

    const doInitialLoad = async () => {
      if (cancelled) return;
      loadingRef.current = true;
      try {
        const entries = await window.snow.gitLog(repoPath, 0, PAGE_SIZE);
        if (cancelled) return;
        if (entries.length < PAGE_SIZE) {
          setHasMore(false);
        }
        if (entries.length > 0) {
          setCommits(entries);
          loadedCountRef.current = entries.length;
        } else {
          setHasMore(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(String(err));
          setHasMore(false);
        }
      } finally {
        if (!cancelled) {
          loadingRef.current = false;
          setIsLoading(false);
        }
      }
    };

    doInitialLoad();

    return () => {
      cancelled = true;
      loadingRef.current = false;
    };
  }, [repoPath]);

  const loadMore = useCallback(() => {
    if (loadingRef.current || !hasMore) return;
    loadPage(loadedCountRef.current, false);
  }, [hasMore, loadPage]);

  // IntersectionObserver for infinite scroll.
  // The scroll container is .git-control (parent), not .git-graph itself.
  // Using viewport (null) as root works because .git-graph doesn't scroll
  // on its own — scrolling happens in the parent .git-control, which moves
  // the sentinel relative to the viewport.
  //
  // IMPORTANT: this effect must re-run after the initial loading completes,
  // because the sentinel is only rendered in the non-loading branch. During
  // the first run (isLoading=true) the sentinel is not in the DOM yet.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMore();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore, isLoading, commits.length]);

  // Fetch commit files when a commit is selected.
  // NOTE: commitFiles is cleared synchronously in handleRowClick (not here)
  // to prevent stale files from the previously selected commit flashing for
  // one frame before this effect runs. useEffect fires AFTER render, so
  // clearing here would render with selectedHash=B but commitFiles=A's data.
  useEffect(() => {
    if (!selectedHash || !repoPath) return;
    let cancelled = false;
    setIsLoadingFiles(true);

    window.snow
      .gitCommitFiles(repoPath, selectedHash)
      .then((files) => {
        if (!cancelled) {
          setCommitFiles(files);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCommitFiles([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingFiles(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedHash, repoPath]);

  const { rows, maxLanes } = useMemo(() => computeGraph(commits), [commits]);
  const graphWidth = Math.max(maxLanes * LANE_WIDTH, LANE_WIDTH);

  const handleRowClick = (hash: string) => {
    setSelectedHash((prev) => {
      if (prev === hash) {
        // Collapsing: no need to touch commitFiles, detail unmounts.
        return null;
      }
      // Expanding a (possibly different) commit: clear stale files and enter
      // loading synchronously in the same batched render so the detail panel
      // shows the loading state immediately instead of the previous commit's
      // file list for one frame.
      setCommitFiles([]);
      setIsLoadingFiles(true);
      return hash;
    });
  };

  if (isLoading) {
    return (
      <div className="git-graph" ref={containerRef}>
        <div className="git-graph-loading">{t("git.graphLoading")}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="git-graph">
        <div className="git-graph-error">{t("git.graphError")}</div>
      </div>
    );
  }

  if (commits.length === 0) {
    return (
      <div className="git-graph">
        <div className="git-graph-empty">{t("git.graphNoCommits")}</div>
      </div>
    );
  }

  return (
    <div className="git-graph" ref={containerRef}>
      {rows.map((row) => {
        const dotColor = LANE_COLORS[row.dotLane % LANE_COLORS.length];
        const isSelected = selectedHash === row.commit.hash;
        return (
          <div key={row.commit.hash}>
            <div
              className={`git-graph-row${isSelected ? " selected" : ""}`}
              onClick={() => handleRowClick(row.commit.hash)}
            >
              <svg
                className="git-graph-svg"
                width={graphWidth}
                height={ROW_HEIGHT}
              >
                {row.topLines.map((lane) => (
                  <line
                    key={`top-${lane}`}
                    x1={lane * LANE_WIDTH + LANE_WIDTH / 2}
                    y1={0}
                    x2={lane * LANE_WIDTH + LANE_WIDTH / 2}
                    y2={ROW_HEIGHT / 2}
                    stroke={LANE_COLORS[lane % LANE_COLORS.length]}
                    strokeWidth={LINE_WIDTH}
                  />
                ))}
                {row.bottomLines.map((lane) => (
                  <line
                    key={`bottom-${lane}`}
                    x1={lane * LANE_WIDTH + LANE_WIDTH / 2}
                    y1={ROW_HEIGHT / 2}
                    x2={lane * LANE_WIDTH + LANE_WIDTH / 2}
                    y2={ROW_HEIGHT}
                    stroke={LANE_COLORS[lane % LANE_COLORS.length]}
                    strokeWidth={LINE_WIDTH}
                  />
                ))}
                {row.curves.map((c, i) => {
                  const fromX = c.from * LANE_WIDTH + LANE_WIDTH / 2;
                  const toX = c.to * LANE_WIDTH + LANE_WIDTH / 2;
                  return (
                    <path
                      key={`curve-${i}`}
                      d={`M ${fromX},${ROW_HEIGHT / 2} C ${fromX},${
                        ROW_HEIGHT * 0.75
                      } ${toX},${ROW_HEIGHT * 0.75} ${toX},${ROW_HEIGHT}`}
                      fill="none"
                      stroke={LANE_COLORS[c.to % LANE_COLORS.length]}
                      strokeWidth={LINE_WIDTH}
                    />
                  );
                })}
                <circle
                  cx={row.dotLane * LANE_WIDTH + LANE_WIDTH / 2}
                  cy={ROW_HEIGHT / 2}
                  r={DOT_RADIUS}
                  fill={dotColor}
                  stroke="var(--bg-primary)"
                  strokeWidth={2}
                />
              </svg>
              <div className="git-graph-info">
                <span className="git-graph-hash">{row.commit.shortHash}</span>
                <span className="git-graph-message" title={row.commit.message}>
                  {row.commit.message}
                </span>
                <span className="git-graph-meta">
                  <span className="git-graph-author">{row.commit.author}</span>
                  <span className="git-graph-date">
                    {formatDate(row.commit.date)}
                  </span>
                </span>
              </div>
            </div>
            {isSelected && (
              <div className="git-graph-detail">
                {commitFiles.length > 0 ? (
                  <div className="git-graph-detail-files">
                    {commitFiles.map((file, i) => (
                      <div key={i} className="git-graph-detail-file">
                        <span
                          className={`git-file-status ${getCommitFileColor(
                            file.status
                          )}`}
                        >
                          {getCommitFileLabel(file.status)}
                        </span>
                        <span
                          className="git-graph-detail-path"
                          title={file.path}
                        >
                          {file.path}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : isLoadingFiles ? (
                  <span className="git-graph-detail-loading">
                    {t("git.graphLoading")}
                  </span>
                ) : (
                  <span className="git-graph-detail-empty">
                    {t("git.graphNoCommits")}
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })}
      {/* Sentinel is always rendered so the ref can bind; visibility is
          controlled by hasMore to avoid an invisible 1px div at the end. */}
      <div
        ref={sentinelRef}
        className="git-graph-sentinel"
        style={{ display: hasMore ? "block" : "none" }}
      />
    </div>
  );
};
