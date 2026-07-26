import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { AutoDismissNotice } from "../../AutoDismissNotice";
import { ConfirmDialog } from "../../common/ConfirmDialog";
import { UsageDateFilter } from "../usageSettings/UsageDateFilter";
import { useI18n } from "../../../i18n";
import type { AppLogPage, AppLogRecord } from "../../../../preload";
import type { UsageDatePreset } from "../usageSettings/types";

const PAGE_SIZE = 50;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

type LogLevelFilter = "" | "DEBUG" | "INFO" | "WARN" | "ERROR";

const LEVEL_FILTERS: LogLevelFilter[] = ["", "DEBUG", "INFO", "WARN", "ERROR"];

type SystemLogsPanelProps = {
  onClose?: () => void;
};

const formatDateForInput = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getMonthStart = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), 1);

const getMonthEnd = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);

const getPresetRange = (
  preset: UsageDatePreset,
  now: Date
): { since: Date; until: Date } => {
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );
  switch (preset) {
    case "today":
      return { since: startOfToday, until: now };
    case "yesterday": {
      const yesterday = new Date(startOfToday.getTime() - ONE_DAY_MS);
      return {
        since: yesterday,
        until: new Date(
          yesterday.getFullYear(),
          yesterday.getMonth(),
          yesterday.getDate(),
          23,
          59,
          59,
          999
        ),
      };
    }
    case "last7days":
      return {
        since: new Date(startOfToday.getTime() - 6 * ONE_DAY_MS),
        until: now,
      };
    case "last30days":
      return {
        since: new Date(startOfToday.getTime() - 29 * ONE_DAY_MS),
        until: now,
      };
    case "thisMonth":
      return { since: getMonthStart(now), until: now };
    case "lastMonth": {
      const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return {
        since: getMonthStart(lastMonthDate),
        until: getMonthEnd(lastMonthDate),
      };
    }
    case "custom":
    default:
      return { since: now, until: now };
  }
};

const formatTime = (value: string): string => {
  if (!value) return "";
  const date = new Date(value.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};

const formatDate = (value: string): string => {
  if (!value) return "";
  const date = new Date(value.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
};

const levelClass = (level: string): string => {
  switch (level) {
    case "DEBUG":
      return "debug";
    case "INFO":
      return "info";
    case "WARN":
      return "warn";
    case "ERROR":
      return "error";
    default:
      return "info";
  }
};

const hasDetail = (record: AppLogRecord): boolean =>
  Boolean(
    record.input ||
      record.output ||
      record.duration ||
      record.context ||
      record.error
  );

export function SystemLogsPanel({
  onClose,
}: SystemLogsPanelProps): React.JSX.Element {
  const { t } = useI18n();
  const [records, setRecords] = useState<AppLogRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [levelFilter, setLevelFilter] = useState<LogLevelFilter>("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [confirmingClear, setConfirmingClear] = useState(false);
  const clearTimerRef = useRef<number | null>(null);

  const [requestLoggingEnabled, setRequestLoggingEnabled] = useState(false);
  const [showRequestLoggingDialog, setShowRequestLoggingDialog] =
    useState(false);
  const [copiedRowLabel, setCopiedRowLabel] = useState<string | null>(null);
  const copyResetTimerRef = useRef<number | null>(null);

  const [datePreset, setDatePreset] = useState<UsageDatePreset>("today");
  const [sinceDate, setSinceDate] = useState<string>(() =>
    formatDateForInput(getPresetRange("today", new Date()).since)
  );
  const [untilDate, setUntilDate] = useState<string>(() =>
    formatDateForInput(getPresetRange("today", new Date()).until)
  );

  const handlePresetChange = useCallback((preset: UsageDatePreset) => {
    setDatePreset(preset);
    if (preset !== "custom") {
      const range = getPresetRange(preset, new Date());
      setSinceDate(formatDateForInput(range.since));
      setUntilDate(formatDateForInput(range.until));
    }
  }, []);

  const handleSinceDateChange = useCallback((value: string) => {
    setSinceDate(value);
    setDatePreset("custom");
  }, []);

  const handleUntilDateChange = useCallback((value: string) => {
    setUntilDate(value);
    setDatePreset("custom");
  }, []);

  const sinceDateTime = useMemo(
    () => (sinceDate ? `${sinceDate} 00:00:00` : ""),
    [sinceDate]
  );
  const untilDateTime = useMemo(
    () => (untilDate ? `${untilDate} 23:59:59` : ""),
    [untilDate]
  );

  const loadLogs = useCallback(
    async (pageOffset: number, level: LogLevelFilter) => {
      setIsLoading(true);
      setError("");
      try {
        const page: AppLogPage = await window.snow.listAppLogs(
          level,
          "",
          sinceDateTime,
          untilDateTime,
          PAGE_SIZE,
          pageOffset
        );
        setRecords(page.items ?? []);
        setTotal(page.total ?? 0);
        setOffset(pageOffset);
        setExpandedIds(new Set());
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message
            : t("settings.systemLogsLoadError", {
                defaultValue: "Failed to load system logs.",
              })
        );
      } finally {
        setIsLoading(false);
      }
    },
    [sinceDateTime, untilDateTime, t]
  );

  useEffect(() => {
    void loadLogs(0, levelFilter);
  }, [loadLogs, levelFilter]);

  useEffect(() => {
    return () => {
      if (clearTimerRef.current !== null) {
        window.clearTimeout(clearTimerRef.current);
      }
      if (copyResetTimerRef.current !== null) {
        window.clearTimeout(copyResetTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    void window.snow
      .getRequestLogging()
      .then(setRequestLoggingEnabled)
      .catch(() => undefined);
  }, []);

  const applyRequestLogging = useCallback(
    async (next: boolean) => {
      const prev = requestLoggingEnabled;
      setRequestLoggingEnabled(next);
      try {
        await window.snow.setRequestLogging(next);
        setNotice(
          next
            ? t("settings.systemLogsRequestLoggingEnabled", {
                defaultValue: "Request logging enabled.",
              })
            : t("settings.systemLogsRequestLoggingDisabled", {
                defaultValue: "Request logging disabled.",
              })
        );
      } catch (e) {
        setRequestLoggingEnabled(prev);
        setError(
          e instanceof Error
            ? e.message
            : t("settings.systemLogsRequestLoggingError", {
                defaultValue: "Failed to toggle request logging.",
              })
        );
      }
    },
    [requestLoggingEnabled, t]
  );

  const handleRequestLoggingToggle = useCallback(() => {
    if (requestLoggingEnabled) {
      void applyRequestLogging(false);
      return;
    }
    setShowRequestLoggingDialog(true);
  }, [requestLoggingEnabled, applyRequestLogging]);

  const confirmRequestLogging = useCallback(() => {
    setShowRequestLoggingDialog(false);
    void applyRequestLogging(true);
  }, [applyRequestLogging]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  const handleLevelFilter = useCallback((level: LogLevelFilter) => {
    setLevelFilter(level);
  }, []);

  const handleRefresh = useCallback(() => {
    void loadLogs(offset, levelFilter);
  }, [loadLogs, offset, levelFilter]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleCopyText = useCallback((text: string, label: string) => {
    navigator.clipboard.writeText(text).catch(() => undefined);
    setCopiedRowLabel(label);
    if (copyResetTimerRef.current !== null) {
      window.clearTimeout(copyResetTimerRef.current);
    }
    copyResetTimerRef.current = window.setTimeout(() => {
      setCopiedRowLabel(null);
      copyResetTimerRef.current = null;
    }, 2000);
  }, []);

  const handleClear = useCallback(async () => {
    if (!confirmingClear) {
      setConfirmingClear(true);
      clearTimerRef.current = window.setTimeout(() => {
        setConfirmingClear(false);
      }, 3000);
      return;
    }
    if (clearTimerRef.current !== null) {
      window.clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }
    setConfirmingClear(false);
    try {
      await window.snow.clearAppLogs();
      setNotice(
        t("settings.systemLogsCleared", {
          defaultValue: "System logs cleared.",
        })
      );
      void loadLogs(0, levelFilter);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : t("settings.systemLogsClearError", {
              defaultValue: "Failed to clear system logs.",
            })
      );
    }
  }, [confirmingClear, levelFilter, loadLogs, t]);

  const detailRows = useCallback(
    (record: AppLogRecord): { label: string; value: string }[] => {
      const rows: { label: string; value: string }[] = [];
      if (record.input) {
        rows.push({
          label: t("settings.systemLogsDetailInput", { defaultValue: "Input" }),
          value: record.input,
        });
      }
      if (record.output) {
        rows.push({
          label: t("settings.systemLogsDetailOutput", {
            defaultValue: "Output",
          }),
          value: record.output,
        });
      }
      if (record.duration) {
        rows.push({
          label: t("settings.systemLogsDetailDuration", {
            defaultValue: "Duration",
          }),
          value: record.duration,
        });
      }
      if (record.context) {
        rows.push({
          label: t("settings.systemLogsDetailContext", {
            defaultValue: "Context",
          }),
          value: record.context,
        });
      }
      if (record.error) {
        rows.push({
          label: t("settings.systemLogsDetailError", { defaultValue: "Error" }),
          value: record.error,
        });
      }
      return rows;
    },
    [t]
  );

  return (
    <div className="api-settings-page system-logs-page" role="region">
      <div className="api-settings-page-header">
        <div className="api-settings-title-group">
          <strong>
            {t("settings.systemLogsTitle", { defaultValue: "System logs" })}
          </strong>
          <span className="settings-item-description">
            {t("settings.systemLogsInfo", {
              defaultValue:
                "Unified diagnostic logs written by the main process and the renderer.",
            })}
          </span>
        </div>
        <div className="system-logs-header-actions">
          <button
            className="icon-btn ghost"
            onClick={handleRefresh}
            type="button"
            disabled={isLoading}
            aria-label={t("settings.systemLogsRefresh", {
              defaultValue: "Refresh logs",
            })}
            title={t("settings.systemLogsRefresh", {
              defaultValue: "Refresh logs",
            })}
          >
            <RefreshCw
              size={15}
              strokeWidth={1.8}
              className={isLoading ? "spin" : ""}
            />
          </button>
          <button
            className={`system-logs-clear-btn${
              confirmingClear ? " confirming" : ""
            }`}
            onClick={() => void handleClear()}
            type="button"
            disabled={total === 0 && !confirmingClear}
          >
            <Trash2 size={14} strokeWidth={1.8} />
            <span>
              {confirmingClear
                ? t("settings.systemLogsClearConfirm", {
                    defaultValue: "Confirm clear",
                  })
                : t("settings.systemLogsClear", { defaultValue: "Clear logs" })}
            </span>
          </button>
          {onClose && (
            <button
              className="icon-btn ghost"
              onClick={onClose}
              type="button"
              aria-label={t("settings.systemLogsClosePanel", {
                defaultValue: "Close system logs",
              })}
              title={t("settings.systemLogsClosePanel", {
                defaultValue: "Close system logs",
              })}
            >
              <X size={15} strokeWidth={1.8} />
            </button>
          )}
        </div>
      </div>

      <AutoDismissNotice
        message={error}
        tone="error"
        onDismiss={() => setError("")}
      />
      <AutoDismissNotice
        message={notice}
        tone="success"
        onDismiss={() => setNotice("")}
      />

      <div className="system-logs-filter-row">
        <div className="system-logs-level-chips" role="tablist">
          {LEVEL_FILTERS.map((level) => (
            <button
              key={level || "all"}
              type="button"
              role="tab"
              aria-selected={levelFilter === level}
              className={`system-logs-level-chip${
                levelFilter === level ? " active" : ""
              }${level ? ` ${levelClass(level)}` : ""}`}
              onClick={() => handleLevelFilter(level)}
            >
              {level ||
                t("settings.systemLogsLevelAll", { defaultValue: "All" })}
            </button>
          ))}
        </div>
      </div>

      <UsageDateFilter
        preset={datePreset}
        sinceDate={sinceDate}
        untilDate={untilDate}
        onPresetChange={handlePresetChange}
        onSinceDateChange={handleSinceDateChange}
        onUntilDateChange={handleUntilDateChange}
      />

      <div className="system-logs-request-logging-row">
        <label className="toggle-switch">
          <input
            type="checkbox"
            checked={requestLoggingEnabled}
            onChange={handleRequestLoggingToggle}
          />
          <span className="toggle-slider" />
          <span className="system-logs-request-logging-label">
            {t("settings.systemLogsRequestLogging", {
              defaultValue: "Request logging",
            })}
          </span>
        </label>
        <span className="settings-item-description">
          {t("settings.systemLogsRequestLoggingDescription", {
            defaultValue:
              "Record the full raw request JSON of every API call. Very high disk usage.",
          })}
        </span>
      </div>

      <ConfirmDialog
        open={showRequestLoggingDialog}
        variant="warning"
        title={t("settings.systemLogsRequestLoggingDialogTitle", {
          defaultValue: "Enable request logging?",
        })}
        message={t("settings.systemLogsRequestLoggingWarning", {
          defaultValue:
            "Request logging records the full raw request JSON of every API call. This has very high disk usage and is not recommended for non-expert users.",
        })}
        confirmLabel={t("settings.systemLogsRequestLoggingConfirm", {
          defaultValue: "Enable",
        })}
        cancelLabel={t("settings.systemLogsRequestLoggingCancel", {
          defaultValue: "Cancel",
        })}
        onConfirm={confirmRequestLogging}
        onCancel={() => setShowRequestLoggingDialog(false)}
      />

      <div className="system-logs-stream-section">
        <div className="system-logs-stream-meta">
          <span className="settings-item-description">
            {t("settings.systemLogsTotalInfo", {
              defaultValue: "{{count}} entries",
              values: { count: total.toLocaleString() },
            })}
          </span>
        </div>

        <div className="system-logs-stream" aria-busy={isLoading}>
          {isLoading ? (
            <div className="system-logs-state">
              {t("settings.systemLogsLoading", { defaultValue: "Loading..." })}
            </div>
          ) : records.length === 0 ? (
            <div className="system-logs-state">
              {t("settings.systemLogsEmpty", {
                defaultValue: "No log entries for the current filters.",
              })}
            </div>
          ) : (
            records.map((record) => {
              const expanded = expandedIds.has(record.id);
              const detail = hasDetail(record);
              const rows = detailRows(record);
              return (
                <div
                  key={record.id}
                  className={`system-logs-entry${expanded ? " expanded" : ""}`}
                >
                  <button
                    type="button"
                    className="system-logs-entry-head"
                    onClick={() => detail && toggleExpand(record.id)}
                    aria-expanded={detail ? expanded : undefined}
                  >
                    <span className="system-logs-entry-time">
                      <span className="system-logs-entry-date">
                        {formatDate(record.createdAt)}
                      </span>
                      <span className="system-logs-entry-clock">
                        {formatTime(record.createdAt)}
                      </span>
                    </span>
                    <span
                      className={`system-logs-level-badge ${levelClass(
                        record.level
                      )}`}
                    >
                      {record.level}
                    </span>
                    <span
                      className={`system-logs-source-tag ${
                        record.source === "renderer" ? "renderer" : "main"
                      }`}
                    >
                      {record.source}
                    </span>
                    <span
                      className="system-logs-entry-location"
                      title={`${record.module}:${record.func}${
                        record.line !== undefined && record.line !== null
                          ? `:${record.line}`
                          : ""
                      }`}
                    >
                      {record.module}
                      {record.func ? `.${record.func}` : ""}
                    </span>
                    <span className="system-logs-entry-message">
                      {record.message || "-"}
                    </span>
                    {detail && (
                      <ChevronDown
                        size={14}
                        strokeWidth={1.8}
                        className="system-logs-entry-chevron"
                      />
                    )}
                  </button>
                  {detail && expanded && (
                    <div className="system-logs-entry-detail">
                      {rows.map((row) => (
                        <div key={row.label} className="system-logs-detail-row">
                          <div className="system-logs-detail-label-row">
                            <span className="system-logs-detail-label">
                              {row.label}
                            </span>
                            <button
                              type="button"
                              className={`system-logs-detail-copy-btn${
                                copiedRowLabel === row.label ? " copied" : ""
                              }`}
                              onClick={() =>
                                handleCopyText(row.value, row.label)
                              }
                              aria-label={t("settings.systemLogsCopy", {
                                defaultValue: "Copy",
                              })}
                              title={t("settings.systemLogsCopy", {
                                defaultValue: "Copy",
                              })}
                            >
                              {copiedRowLabel === row.label ? (
                                <Check size={12} strokeWidth={1.8} />
                              ) : (
                                <Copy size={12} strokeWidth={1.8} />
                              )}
                            </button>
                          </div>
                          <span className="system-logs-detail-value">
                            {row.value}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {total > PAGE_SIZE && (
          <div className="usage-pagination">
            <button
              className="usage-pagination-btn"
              onClick={() =>
                void loadLogs(Math.max(0, offset - PAGE_SIZE), levelFilter)
              }
              disabled={offset === 0 || isLoading}
              type="button"
              aria-label={t("settings.systemLogsPrevPage", {
                defaultValue: "Previous page",
              })}
            >
              <ChevronLeft size={16} strokeWidth={1.8} />
            </button>
            <span className="usage-pagination-info">
              {t("settings.systemLogsPageInfo", {
                defaultValue: "Page {{current}} of {{total}}",
                values: { current: currentPage, total: totalPages },
              })}
            </span>
            <button
              className="usage-pagination-btn"
              onClick={() =>
                void loadLogs(
                  Math.min((totalPages - 1) * PAGE_SIZE, offset + PAGE_SIZE),
                  levelFilter
                )
              }
              disabled={currentPage >= totalPages || isLoading}
              type="button"
              aria-label={t("settings.systemLogsNextPage", {
                defaultValue: "Next page",
              })}
            >
              <ChevronRight size={16} strokeWidth={1.8} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
