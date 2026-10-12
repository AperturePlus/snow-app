import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppWindow,
  ArrowDown,
  ArrowUp,
  Boxes,
  Cpu,
  Loader2,
  MemoryStick,
  MonitorCog,
  RefreshCw,
  Wrench,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import { useI18n } from "../../i18n";
import { ConfirmDialog } from "../common/ConfirmDialog";
import type {
  TaskManagerProcess,
  TaskManagerProcessKind,
} from "../../../preload";

/** 自动刷新间隔：与 Chrome 任务管理器同量级，够实时又不会明显增加开销。 */
const REFRESH_INTERVAL_MS = 1000;

type SortField = "name" | "kind" | "pid" | "cpu" | "memory" | "threads";
type SortDirection = "asc" | "desc";

/** 进程类型 → i18n 键（标签文案在渲染时解析）。 */
const KIND_LABEL_KEYS: Record<TaskManagerProcessKind, string> = {
  browser: "taskManager.kindBrowser",
  renderer: "taskManager.kindRenderer",
  gpu: "taskManager.kindGpu",
  utility: "taskManager.kindUtility",
  child: "taskManager.kindChild",
};

/** 取不到系统图标时的回退图标（按进程类型区分）。 */
const KIND_FALLBACK_ICONS: Record<TaskManagerProcessKind, LucideIcon> = {
  browser: Cpu,
  renderer: AppWindow,
  gpu: MonitorCog,
  utility: Wrench,
  child: Boxes,
};

const ProcessFallbackIcon = ({
  kind,
  className,
}: {
  kind: TaskManagerProcessKind;
  className?: string;
}): React.JSX.Element => {
  const Icon = KIND_FALLBACK_ICONS[kind];
  return (
    <Icon
      size={14}
      strokeWidth={1.7}
      className={className}
      aria-hidden="true"
    />
  );
};

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

/** CPU 百分比：-1 表示本次采样没有基线（首次采集），显示占位符。 */
const formatCpu = (percent: number): string =>
  percent < 0 ? "—" : `${percent.toFixed(1)}%`;

/** 进程在界面上的展示名：优先语义标签（页面标题 / 服务名），回退可执行文件名。 */
const displayName = (process: TaskManagerProcess): string =>
  process.title || process.serviceName || process.name;

type TaskManagerContentProps = {
  /** tab 是否为当前激活项：非激活时暂停轮询，避免后台空转。 */
  isActive: boolean;
};

/**
 * 应用任务管理器面板。
 *
 * 数据来自主进程 `processes:snapshot`（Rust 采集进程树事实 + Electron 补语义），
 * 仅在面板可见且窗口未被隐藏时按固定间隔轮询；CPU 百分比本身是两次采样之差，
 * 因此轮询间隔同时决定了 CPU 数值的口径。
 */
export const TaskManagerContent = ({
  isActive,
}: TaskManagerContentProps): React.JSX.Element => {
  const { t } = useI18n();
  const [processes, setProcesses] = useState<TaskManagerProcess[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [sortField, setSortField] = useState<SortField>("memory");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [pendingKill, setPendingKill] = useState<TaskManagerProcess | null>(
    null,
  );
  const [isKilling, setIsKilling] = useState(false);
  const [killError, setKillError] = useState<string | null>(null);
  // 防止慢请求堆积：同一时刻只允许一个在途请求。
  const inFlightRef = useRef(false);

  const refresh = useCallback(async (): Promise<void> => {
    if (inFlightRef.current) {
      return;
    }
    inFlightRef.current = true;
    try {
      const snapshot = await window.snow.getProcessSnapshot();
      setProcesses(snapshot);
      setHasError(false);
    } catch {
      setHasError(true);
    } finally {
      inFlightRef.current = false;
      setIsLoading(false);
    }
  }, []);

  // 首次挂载立即采集一次；激活状态下按固定间隔轮询。
  useEffect(() => {
    if (!isActive) {
      return undefined;
    }
    void refresh();
    if (!autoRefresh) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      // 窗口被隐藏时跳过采样：后台不需要刷新数值（也避免无谓的系统调用）。
      if (!document.hidden) {
        void refresh();
      }
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [isActive, autoRefresh, refresh]);

  const summary = useMemo(() => {
    let memory = 0;
    let cpu = 0;
    let hasCpu = false;
    for (const process of processes) {
      memory += process.memoryBytes;
      if (process.cpuPercent >= 0) {
        cpu += process.cpuPercent;
        hasCpu = true;
      }
    }
    return { memory, cpu, hasCpu, count: processes.length };
  }, [processes]);

  const sortedProcesses = useMemo(() => {
    const factor = sortDirection === "asc" ? 1 : -1;
    const compare = (
      left: TaskManagerProcess,
      right: TaskManagerProcess,
    ): number => {
      switch (sortField) {
        case "name":
          return displayName(left).localeCompare(displayName(right)) * factor;
        case "kind":
          return left.kind.localeCompare(right.kind) * factor;
        case "pid":
          return (left.pid - right.pid) * factor;
        case "cpu":
          return (left.cpuPercent - right.cpuPercent) * factor;
        case "threads":
          return (left.threadCount - right.threadCount) * factor;
        case "memory":
        default:
          return (left.memoryBytes - right.memoryBytes) * factor;
      }
    };
    return [...processes].sort(compare);
  }, [processes, sortField, sortDirection]);

  const handleSort = (field: SortField): void => {
    if (field === sortField) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortField(field);
    // 数值列默认降序（先看占用大户），文本列默认升序。
    setSortDirection(field === "name" || field === "kind" ? "asc" : "desc");
  };

  const handleConfirmKill = async (): Promise<void> => {
    if (!pendingKill) {
      return;
    }
    setIsKilling(true);
    setKillError(null);
    try {
      await window.snow.killProcessTree(pendingKill.pid);
      setPendingKill(null);
      await refresh();
    } catch (error) {
      setKillError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsKilling(false);
    }
  };

  const renderSortIcon = (field: SortField): React.ReactNode => {
    if (field !== sortField) {
      return null;
    }
    return sortDirection === "asc" ? (
      <ArrowUp size={11} strokeWidth={2} aria-hidden="true" />
    ) : (
      <ArrowDown size={11} strokeWidth={2} aria-hidden="true" />
    );
  };

  const sortableHeader = (
    field: SortField,
    label: string,
    className: string,
  ): React.ReactNode => (
    <th className={className}>
      <button
        type="button"
        className="task-manager-sort-btn"
        onClick={() => handleSort(field)}
        title={t("taskManager.sortBy", { values: { column: label } })}
      >
        <span>{label}</span>
        {renderSortIcon(field)}
      </button>
    </th>
  );

  return (
    <div className="task-manager">
      <div className="task-manager-toolbar">
        <div className="task-manager-summary">
          <span className="task-manager-summary-item">
            {t("taskManager.processCount", {
              values: { count: summary.count },
            })}
          </span>
          <span className="task-manager-summary-item">
            <MemoryStick size={12} strokeWidth={1.8} aria-hidden="true" />
            {formatBytes(summary.memory)}
          </span>
          <span className="task-manager-summary-item">
            <Cpu size={12} strokeWidth={1.8} aria-hidden="true" />
            {summary.hasCpu ? `${summary.cpu.toFixed(1)}%` : "—"}
          </span>
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
          onClick={() => void refresh()}
          title={t("taskManager.refresh")}
        >
          <RefreshCw size={13} strokeWidth={1.8} aria-hidden="true" />
          <span>{t("taskManager.refresh")}</span>
        </button>
      </div>

      {isLoading ? (
        <div className="task-manager-state">
          <Loader2 size={18} strokeWidth={1.8} className="spin" />
        </div>
      ) : hasError ? (
        <div className="task-manager-state task-manager-error">
          {t("taskManager.loadError")}
        </div>
      ) : sortedProcesses.length === 0 ? (
        <div className="task-manager-state">{t("taskManager.empty")}</div>
      ) : (
        <div className="task-manager-table-wrap">
          <table className="task-manager-table">
            <thead>
              <tr>
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
                  t("taskManager.colCpu"),
                  "task-manager-col-cpu",
                )}
                {sortableHeader(
                  "memory",
                  t("taskManager.colMemory"),
                  "task-manager-col-memory",
                )}
                {sortableHeader(
                  "threads",
                  t("taskManager.colThreads"),
                  "task-manager-col-threads",
                )}
                <th className="task-manager-col-actions">
                  <span className="task-manager-col-actions-label">
                    {t("taskManager.colActions")}
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedProcesses.map((process) => (
                <tr key={process.pid}>
                  <td
                    className="task-manager-cell-name"
                    title={
                      process.exePath || process.url || displayName(process)
                    }
                  >
                    <span className="task-manager-name-main">
                      {process.iconDataUrl ? (
                        <img
                          className="task-manager-process-icon"
                          src={process.iconDataUrl}
                          alt=""
                          aria-hidden="true"
                        />
                      ) : (
                        <ProcessFallbackIcon
                          kind={process.kind}
                          className="task-manager-process-icon"
                        />
                      )}
                      <span className="task-manager-name-text">
                        {displayName(process)}
                      </span>
                    </span>
                    {process.title && process.name ? (
                      <span className="task-manager-name-sub">
                        {process.name}
                      </span>
                    ) : null}
                  </td>
                  <td className="task-manager-cell-kind">
                    {t(KIND_LABEL_KEYS[process.kind])}
                  </td>
                  <td className="task-manager-cell-num">{process.pid}</td>
                  <td className="task-manager-cell-num">
                    {formatCpu(process.cpuPercent)}
                  </td>
                  <td className="task-manager-cell-num">
                    {formatBytes(process.memoryBytes)}
                  </td>
                  <td className="task-manager-cell-num">
                    {process.threadCount}
                  </td>
                  <td className="task-manager-cell-actions">
                    {process.killable ? (
                      <button
                        type="button"
                        className="task-manager-kill-btn"
                        onClick={() => {
                          setKillError(null);
                          setPendingKill(process);
                        }}
                        title={t("taskManager.endProcess")}
                      >
                        <XCircle
                          size={13}
                          strokeWidth={1.8}
                          aria-hidden="true"
                        />
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={pendingKill !== null}
        title={t("taskManager.endProcessTitle")}
        message={
          pendingKill
            ? t("taskManager.endProcessConfirm", {
                values: {
                  name: displayName(pendingKill),
                  pid: pendingKill.pid,
                },
              })
            : ""
        }
        confirmLabel={t("taskManager.endProcess")}
        cancelLabel={t("common.cancel", { defaultValue: "Cancel" })}
        onConfirm={() => void handleConfirmKill()}
        onCancel={() => {
          if (!isKilling) {
            setPendingKill(null);
            setKillError(null);
          }
        }}
        isConfirming={isKilling}
        variant="danger"
      >
        {killError ? (
          <p className="task-manager-kill-error">{killError}</p>
        ) : null}
      </ConfirmDialog>
    </div>
  );
};
