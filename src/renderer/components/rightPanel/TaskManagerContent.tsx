import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Boxes,
  Cpu,
  Loader2,
  MemoryStick,
  RefreshCw,
  Search,
} from "lucide-react";
import { useI18n } from "../../i18n";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { LspResourcePanel } from "../sidebar/lspSettings/LspResourcePanel";
import type { TaskManagerProcess } from "../../../preload";
import {
  associateLspProcesses,
  captureSessions,
  filterTaskProcesses,
  LSP_REFRESH_INTERVAL_MS,
  normalizeTaskProject,
  processIdentity,
  reconcileSessionRoots,
  SNAPSHOT_FRESHNESS_MS,
  summarizeProcesses,
  uniqueProcesses,
  type SessionSnapshot,
  type TaskManagerRow,
} from "./taskManagerModel";
import { TaskManagerTrend, useUsageTrend } from "./TaskManagerTrend";
import { TaskManagerProcessTable } from "./TaskManagerProcessTable";
import { TaskManagerSessions } from "./TaskManagerSessions";
import { TaskManagerAlerts } from "./TaskManagerAlerts";
import {
  CONTINUOUS_SAMPLE_GAP_MS,
  TREND_WINDOW_MS,
  type SampleStamp,
} from "./taskManagerMonitoring";
import {
  formatTaskBytes,
  formatTaskTotalCpu,
  taskDisplayName,
  taskProjectName,
} from "./taskManagerPresentation";

const REFRESH_INTERVAL_MS = 1000;
type SortField = "name" | "kind" | "pid" | "cpu" | "memory" | "threads";
type SortDirection = "asc" | "desc";

/** One process sampler serves rows, scoped trends and optional inline alerts. */
export const TaskManagerContent = ({
  isActive,
}: {
  isActive: boolean;
}): React.JSX.Element => {
  const { t, locale } = useI18n();
  const [processes, setProcesses] = useState<TaskManagerProcess[]>([]);
  const [sessionSnapshot, setSessionSnapshot] =
    useState<SessionSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [lspError, setLspError] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [hidden, setHidden] = useState(document.hidden);
  const [sampledAtMs, setSampledAtMs] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [stamp, setStamp] = useState<SampleStamp | null>(null);
  const [continuity, setContinuity] = useState(0);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "lsp">("all");
  const [project, setProject] = useState("");
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [sortField, setSortField] = useState<SortField>("memory");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [pendingKill, setPendingKill] = useState<TaskManagerProcess | null>(
    null,
  );
  const [isKilling, setIsKilling] = useState(false);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [killError, setKillError] = useState<string | null>(null);
  const inFlightRef = useRef(false);
  const forceQueuedRef = useRef(false);
  const refreshWaitersRef = useRef<Array<() => void>>([]);
  const refreshRef = useRef<((force?: boolean) => Promise<void>) | null>(null);
  const lastLspAttemptRef = useRef(0);
  const mountedRef = useRef(false);
  const activeRef = useRef(isActive);
  const sampledRef = useRef(0);
  const sequenceRef = useRef(0);
  const continuityRef = useRef(0);
  const scopeKey = JSON.stringify([
    query.trim().toLocaleLowerCase(),
    filter,
    project,
  ]);
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  activeRef.current = isActive;
  const breakSampling = useCallback((): void => {
    continuityRef.current += 1;
    setContinuity(continuityRef.current);
  }, []);

  const refresh = useCallback(
    async (forceLsp = false): Promise<void> => {
      if (!activeRef.current || document.hidden) return;
      if (inFlightRef.current) {
        if (!forceLsp) return;
        forceQueuedRef.current = true;
        return new Promise<void>((resolve) =>
          refreshWaitersRef.current.push(resolve),
        );
      }
      inFlightRef.current = true;
      const requestScope = scopeRef.current;
      const requestContinuity = continuityRef.current;
      const fetchLsp =
        forceLsp ||
        Date.now() - lastLspAttemptRef.current >= LSP_REFRESH_INTERVAL_MS;
      if (fetchLsp) lastLspAttemptRef.current = Date.now();
      try {
        const [processResult, sessionResult] = await Promise.allSettled([
          window.snow
            .getProcessSnapshot()
            .then((value) => ({ value, receivedAtMs: Date.now() })),
          fetchLsp
            ? window.snow
                .listLspSessionStatuses()
                .then((value) => ({ value, receivedAtMs: Date.now() }))
            : Promise.resolve(null),
        ]);
        if (!mountedRef.current) return;
        const snapshot =
          processResult.status === "fulfilled"
            ? uniqueProcesses(processResult.value.value)
            : null;
        if (snapshot && processResult.status === "fulfilled") {
          setProcesses(snapshot);
          sampledRef.current = processResult.value.receivedAtMs;
          setSampledAtMs(processResult.value.receivedAtMs);
          setHasError(false);
          sequenceRef.current += 1;
          setStamp({
            id: sequenceRef.current,
            atMs: processResult.value.receivedAtMs,
            scopeKey: requestScope,
            continuity: requestContinuity,
          });
        } else {
          setHasError(true);
          breakSampling();
        }
        if (fetchLsp) {
          if (
            sessionResult.status === "fulfilled" &&
            sessionResult.value !== null
          ) {
            setSessionSnapshot(
              captureSessions(
                sessionResult.value.value,
                snapshot ?? [],
                sessionResult.value.receivedAtMs,
              ),
            );
            setLspError(false);
          } else {
            setLspError(true);
            if (snapshot)
              setSessionSnapshot((previous) =>
                previous ? reconcileSessionRoots(previous, snapshot) : null,
              );
          }
        } else if (snapshot) {
          setSessionSnapshot((previous) =>
            previous ? reconcileSessionRoots(previous, snapshot) : null,
          );
        }
        setNow(Date.now());
      } finally {
        inFlightRef.current = false;
        if (mountedRef.current) setIsLoading(false);
        const queued = forceQueuedRef.current;
        forceQueuedRef.current = false;
        const waiters = refreshWaitersRef.current.splice(0);
        if (
          queued &&
          mountedRef.current &&
          activeRef.current &&
          !document.hidden
        ) {
          void refreshRef
            .current?.(true)
            .finally(() => waiters.forEach((resolve) => resolve()));
        } else waiters.forEach((resolve) => resolve());
      }
    },
    [breakSampling],
  );
  refreshRef.current = refresh;
  const forceRefresh = useCallback(() => refresh(true), [refresh]);

  useEffect(() => {
    mountedRef.current = true;
    const onVisibility = (): void => {
      setHidden(document.hidden);
      setNow(Date.now());
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      mountedRef.current = false;
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  useEffect(() => {
    breakSampling();
  }, [scopeKey, breakSampling]);
  useEffect(() => {
    breakSampling();
    if (!isActive || hidden) return;
    setNow(Date.now());
    if (!autoRefresh) {
      if (!sampledRef.current) void refresh(true);
      return;
    }
    void refresh(true);
    const timer = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [isActive, hidden, autoRefresh, refresh, breakSampling]);
  // Finite expiry events only: age retained data during pauses/slow requests without fetching.
  useEffect(() => {
    if (!isActive || hidden) return;
    const currentTime = Date.now();
    const samples = [
      sampledAtMs,
      sessionSnapshot?.receivedAtMs ?? 0,
      ...(sessionSnapshot?.sessions.map(
        (session) => session.resources?.sampledAtMs ?? 0,
      ) ?? []),
    ];
    const expiries = samples.flatMap((sample) => [
      sample + SNAPSHOT_FRESHNESS_MS + 1,
      sample + TREND_WINDOW_MS + 1,
    ]);
    expiries.push(sampledAtMs + CONTINUOUS_SAMPLE_GAP_MS + 1);
    const next = expiries.filter((expiry) => expiry > currentTime);
    if (!next.length) return;
    const timer = window.setTimeout(
      () => setNow(Date.now()),
      Math.min(...next) - currentTime,
    );
    return () => window.clearTimeout(timer);
  }, [isActive, hidden, sampledAtMs, sessionSnapshot, now]);

  const processStale =
    hasError || !sampledAtMs || now - sampledAtMs > SNAPSHOT_FRESHNESS_MS;
  const sessionsStale =
    lspError ||
    !sessionSnapshot ||
    now - sessionSnapshot.receivedAtMs > SNAPSHOT_FRESHNESS_MS;
  const rows = useMemo(
    () =>
      associateLspProcesses(
        processes,
        sessionSnapshot,
        now,
        processStale || sessionsStale,
      ),
    [processes, sessionSnapshot, now, processStale, sessionsStale],
  );
  const visibleRows = useMemo(
    () => filterTaskProcesses(rows, { query, kind: filter, project }),
    [rows, query, filter, project],
  );
  const summary = useMemo(() => summarizeProcesses(visibleRows), [visibleRows]);
  const scopeKnown =
    !processStale &&
    (!(filter === "lsp" || project || query.trim()) || !sessionsStale);
  const usageSamples = useUsageTrend({
    stamp,
    scopeKey,
    summary,
    scopeKnown,
    continuity,
    now,
  });
  const groups = useMemo(() => {
    const grouped = new Map<
      NonNullable<TaskManagerRow["lspSession"]>,
      TaskManagerRow[]
    >();
    for (const row of visibleRows) {
      if (!row.lspSession) continue;
      const group = grouped.get(row.lspSession) ?? [];
      group.push(row);
      grouped.set(row.lspSession, group);
    }
    return grouped;
  }, [visibleRows]);
  const search = query.trim().toLocaleLowerCase();
  const sessions = (sessionSnapshot?.sessions ?? []).filter(
    (session) =>
      (!project || normalizeTaskProject(session.projectRoot) === project) &&
      (!search ||
        groups.has(session) ||
        [session.lang, session.projectRoot, session.resources?.pid]
          .join(" ")
          .toLocaleLowerCase()
          .includes(search)),
  );
  const projects = useMemo(() => {
    const roots = new Map<string, string>();
    for (const session of sessionSnapshot?.sessions ?? [])
      roots.set(normalizeTaskProject(session.projectRoot), session.projectRoot);
    return [...roots.entries()].sort((left, right) =>
      left[1].localeCompare(right[1]),
    );
  }, [sessionSnapshot]);
  const selectProject = useCallback(
    (root: string): void => setProject(normalizeTaskProject(root)),
    [],
  );
  const sortedProcesses = useMemo(() => {
    const factor = sortDirection === "asc" ? 1 : -1;
    return [...visibleRows].sort((left, right) => {
      let compared = 0;
      switch (sortField) {
        case "name":
          compared = taskDisplayName(left).localeCompare(
            taskDisplayName(right),
          );
          break;
        case "kind":
          compared = left.kind.localeCompare(right.kind);
          break;
        case "pid":
          compared = left.pid - right.pid;
          break;
        case "cpu":
          compared = left.cpuPercent - right.cpuPercent;
          break;
        case "threads":
          compared = left.threadCount - right.threadCount;
          break;
        default:
          compared = left.memoryBytes - right.memoryBytes;
      }
      return compared * factor || left.pid - right.pid;
    });
  }, [visibleRows, sortField, sortDirection]);
  const handleSort = (field: SortField): void => {
    if (field === sortField)
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    else {
      setSortField(field);
      setSortDirection(field === "name" || field === "kind" ? "asc" : "desc");
    }
  };
  const killLockRef = useRef(false);
  const handleConfirmKill = async (): Promise<void> => {
    if (!pendingKill || killLockRef.current || sessionBusy) return;
    const current = processes.find(
      (process) => process.pid === pendingKill.pid,
    );
    if (
      hasError ||
      Date.now() - sampledRef.current > SNAPSHOT_FRESHNESS_MS ||
      !current?.killable ||
      processIdentity(current) !== processIdentity(pendingKill)
    ) {
      setKillError(t("taskManager.processChanged"));
      return;
    }
    killLockRef.current = true;
    setIsKilling(true);
    setKillError(null);
    try {
      await window.snow.killProcessTree(pendingKill.pid);
      setPendingKill(null);
      breakSampling();
      await refresh(true);
    } catch (error) {
      setKillError(error instanceof Error ? error.message : String(error));
    } finally {
      killLockRef.current = false;
      setIsKilling(false);
    }
  };
  const sortableHeader = (
    field: SortField,
    label: string,
    className: string,
  ): React.ReactNode => (
    <th
      className={className}
      scope="col"
      aria-sort={
        field === sortField
          ? sortDirection === "asc"
            ? "ascending"
            : "descending"
          : "none"
      }
    >
      <button
        type="button"
        className="task-manager-sort-btn"
        onClick={() => handleSort(field)}
        title={t("taskManager.sortBy", { values: { column: label } })}
      >
        <span>{label}</span>
        {field === sortField &&
          (sortDirection === "asc" ? (
            <ArrowUp size={11} aria-hidden="true" />
          ) : (
            <ArrowDown size={11} aria-hidden="true" />
          ))}
      </button>
    </th>
  );
  const time = (value: number): string =>
    new Date(value).toLocaleTimeString(locale);
  return (
    <div className="task-manager">
      <div
        className="task-manager-summary"
        aria-label={t("taskManager.visibleTotals")}
      >
        <div className="task-manager-stat">
          <Boxes size={14} aria-hidden="true" />
          <strong>{summary.count}</strong>
          <span>{t("taskManager.visibleProcesses")}</span>
        </div>
        <div className="task-manager-stat">
          <MemoryStick size={14} aria-hidden="true" />
          <strong>{formatTaskBytes(summary.memory)}</strong>
          <span>{t("taskManager.visibleMemory")}</span>
        </div>
        <div className="task-manager-stat">
          <Cpu size={14} aria-hidden="true" />
          <strong>{formatTaskTotalCpu(summary)}</strong>
          <span>{t("taskManager.visibleCpu")}</span>
        </div>
      </div>
      <div className="task-manager-toolbar">
        <label className="task-manager-search">
          <Search size={13} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("taskManager.search")}
            aria-label={t("taskManager.search")}
          />
        </label>
        <div
          className="task-manager-filters"
          role="group"
          aria-label={t("taskManager.filter")}
        >
          <button
            type="button"
            aria-pressed={filter === "all"}
            onClick={() => setFilter("all")}
          >
            {t("taskManager.all")}
          </button>
          <button
            type="button"
            aria-pressed={filter === "lsp"}
            onClick={() => setFilter("lsp")}
          >
            LSP
          </button>
        </div>
        <label className="toggle-switch task-manager-auto-refresh">
          <span>{t("taskManager.autoRefresh")}</span>
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(event) => setAutoRefresh(event.target.checked)}
          />
          <span className="toggle-slider" />
        </label>
        <button
          type="button"
          className="task-manager-refresh-btn"
          onClick={() => void refresh(true)}
          title={t("taskManager.refresh")}
          aria-label={t("taskManager.refresh")}
        >
          <RefreshCw size={13} aria-hidden="true" />
        </button>
      </div>
      <div className="task-manager-project-filter">
        <label>
          <span>{t("taskManager.projectScope")}</span>
          <select
            value={project}
            data-project-filter="true"
            onChange={(event) => setProject(event.target.value)}
            aria-label={t("taskManager.projectScope")}
            title={projects.find(([key]) => key === project)?.[1] || project}
          >
            <option value="">{t("taskManager.allProjects")}</option>
            {project && !projects.some(([key]) => key === project) && (
              <option value={project}>{project}</option>
            )}
            {projects.map(([key, root]) => (
              <option key={key} value={key}>
                {taskProjectName(root)} · {root}
              </option>
            ))}
          </select>
        </label>
        {project && (
          <button
            type="button"
            className="task-manager-refresh-btn"
            onClick={() => setProject("")}
          >
            {t("taskManager.clearProject")}
          </button>
        )}
      </div>
      {project && (
        <p
          className="task-manager-selected-project"
          title={projects.find(([key]) => key === project)?.[1] || project}
        >
          {t("taskManager.selectedProject", {
            values: {
              project:
                projects.find(([key]) => key === project)?.[1] || project,
            },
          })}
        </p>
      )}
      <div className="task-manager-status">
        <span>
          {autoRefresh && !hidden
            ? t("taskManager.autoSampling")
            : t("taskManager.paused")}
        </span>
        <span>
          {sampledAtMs
            ? t("taskManager.lastSnapshot", {
                values: { time: time(sampledAtMs) },
              })
            : "—"}
        </span>
        {processStale && !isLoading && (
          <span className="task-manager-error">
            {t("taskManager.processStale")}
          </span>
        )}
      </div>
      <p className="task-manager-hint task-manager-accounting">
        {t("taskManager.accounting")}
      </p>
      <TaskManagerTrend samples={usageSamples} now={now} />
      <details
        className="task-manager-disclosure"
        open={budgetOpen}
        onToggle={(event) => setBudgetOpen(event.currentTarget.open)}
      >
        <summary>{t("taskManager.budgetTitle")}</summary>
        <LspResourcePanel isActive={isActive && !hidden && budgetOpen} />
      </details>
      <TaskManagerSessions
        isActive={isActive && !hidden}
        sessions={sessions}
        rows={rows}
        groups={groups}
        snapshot={sessionSnapshot}
        processStale={processStale}
        sessionsStale={sessionsStale}
        now={now}
        externalBusy={pendingKill !== null || isKilling}
        onBusyChange={setSessionBusy}
        onRefresh={forceRefresh}
        onProject={selectProject}
      />
      <TaskManagerAlerts
        samples={usageSamples}
        scopeKey={scopeKey}
        continuity={continuity}
        samplingActive={isActive && !hidden && autoRefresh}
        valid={scopeKnown && !hasError}
      />
      {hasError && (
        <p className="task-manager-notice task-manager-error" role="status">
          {t("taskManager.loadError")}
        </p>
      )}
      {isLoading ? (
        <div
          className="task-manager-state"
          role="status"
          aria-label={t("taskManager.loading")}
        >
          <Loader2 size={18} className="spin" aria-hidden="true" />
        </div>
      ) : (
        <TaskManagerProcessTable
          sortedRows={sortedProcesses}
          stale={processStale}
          actionsDisabled={isKilling || sessionBusy || pendingKill !== null}
          onKill={(process) => {
            setKillError(null);
            setPendingKill(process);
          }}
          onProject={selectProject}
          headers={
            <>
              {sortableHeader(
                "name",
                t("taskManager.colName"),
                "task-manager-col-name",
              )}
              {sortableHeader(
                "kind",
                t("taskManager.colType"),
                "task-manager-col-kind",
              )}
              {sortableHeader(
                "pid",
                t("taskManager.colPid"),
                "task-manager-col-pid",
              )}
              {sortableHeader(
                "cpu",
                t("taskManager.ownCpu"),
                "task-manager-col-cpu",
              )}
              {sortableHeader(
                "memory",
                t("taskManager.ownMemory"),
                "task-manager-col-memory",
              )}
              {sortableHeader(
                "threads",
                t("taskManager.colThreads"),
                "task-manager-col-threads",
              )}
              <th scope="col" className="task-manager-col-actions">
                <span className="task-manager-col-actions-label">
                  {t("taskManager.colActions")}
                </span>
              </th>
            </>
          }
        />
      )}
      <ConfirmDialog
        open={pendingKill !== null}
        title={t("taskManager.endProcessTitle")}
        message={
          pendingKill
            ? t("taskManager.endProcessConfirm", {
                values: {
                  name: taskDisplayName(pendingKill),
                  pid: pendingKill.pid,
                },
              })
            : ""
        }
        confirmLabel={t("taskManager.endProcess")}
        cancelLabel={t("common.cancel", { defaultValue: "Cancel" })}
        onConfirm={() => void handleConfirmKill()}
        onCancel={() => {
          if (!killLockRef.current) {
            setPendingKill(null);
            setKillError(null);
          }
        }}
        isConfirming={isKilling}
        variant="danger"
      >
        {killError && <p className="task-manager-kill-error">{killError}</p>}
      </ConfirmDialog>
    </div>
  );
};
