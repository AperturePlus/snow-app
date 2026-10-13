import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import {
  advanceUsageAlerts,
  alertOptionsValid,
  CONTINUOUS_SAMPLE_GAP_MS,
  emptyUsageAlerts,
  type AlertOptions,
  type UsageAlerts,
  type UsageSample,
} from "./taskManagerMonitoring";

type Props = {
  samples: UsageSample[];
  scopeKey: string;
  continuity: number;
  samplingActive: boolean;
  valid: boolean;
  mode?: "all" | "notice-only" | "panel-only";
};

/** Ephemeral panel-only preferences. No notifications, automatic termination or config writes. */
export function TaskManagerAlerts({
  samples,
  scopeKey,
  continuity,
  samplingActive,
  valid,
  mode = "all",
}: Props): React.JSX.Element {
  const { t } = useI18n();
  const [options, setOptions] = useState<AlertOptions>({
    enabled: false,
    cpuPercent: 70,
    memoryMiB: 1024,
    durationSecs: 10,
  });
  const [alerts, setAlerts] = useState<UsageAlerts>(emptyUsageAlerts);
  const alertsRef = useRef<UsageAlerts>(emptyUsageAlerts());
  const consumedAtRef = useRef(0);
  const latest = samples.at(-1);
  const configValid = alertOptionsValid(options);
  useEffect(() => {
    alertsRef.current = emptyUsageAlerts();
    consumedAtRef.current = latest?.atMs ?? 0;
    setAlerts(alertsRef.current);
    // The current sample predates this configuration/continuity boundary; do not reuse it.
  }, [options, scopeKey, continuity, samplingActive, valid]);
  useEffect(() => {
    if (!latest || latest.atMs <= consumedAtRef.current) return;
    consumedAtRef.current = latest.atMs;
    if (!samplingActive || !valid) return;
    alertsRef.current = advanceUsageAlerts(alertsRef.current, latest, options);
    setAlerts(alertsRef.current);
  }, [latest, options, samplingActive, valid]);
  useEffect(() => {
    if (!latest || !options.enabled || !samplingActive || !valid) return;
    const reset = (): void => {
      alertsRef.current = emptyUsageAlerts();
      setAlerts(alertsRef.current);
    };
    const remaining = latest.atMs + CONTINUOUS_SAMPLE_GAP_MS + 1 - Date.now();
    if (remaining <= 0) {
      reset();
      return;
    }
    const timer = window.setTimeout(reset, remaining);
    return () => window.clearTimeout(timer);
  }, [latest, options.enabled, samplingActive, valid]);
  const dismiss = (metric: "cpu" | "memory"): void => {
    alertsRef.current = {
      ...alertsRef.current,
      [metric]: { ...alertsRef.current[metric], dismissed: true },
    };
    setAlerts(alertsRef.current);
  };
  const fields = [
    ["cpuPercent", "taskManager.alertCpu", 0, 100, 1],
    ["memoryMiB", "taskManager.alertMemory", 1, 1048576, 1],
    ["durationSecs", "taskManager.alertDuration", 3, 120, 1],
  ] as const;
  return (
    <>
      {mode !== "notice-only" && (
        <details
          className="task-manager-disclosure task-manager-alert-settings"
          open={mode === "panel-only" || undefined}
        >
          <summary>
            {t("taskManager.alertTitle")} ·{" "}
            {t(
              options.enabled
                ? "taskManager.alertEnabled"
                : "taskManager.alertDisabled",
            )}
          </summary>
          <div className="task-manager-alert-body">
            <label className="task-manager-alert-enable">
              <input
                type="checkbox"
                checked={options.enabled}
                onChange={(event) =>
                  setOptions((current) => ({
                    ...current,
                    enabled: event.target.checked,
                  }))
                }
              />
              {t("taskManager.alertEnable")}
            </label>
            <p className="task-manager-hint">{t("taskManager.alertHint")}</p>
            <div className="task-manager-budget-fields">
              {fields.map(([key, label, min, max, step]) => (
                <label key={key}>
                  <span>{t(label)}</span>
                  <input
                    type="number"
                    data-alert-field={key}
                    min={min}
                    max={max}
                    step={step}
                    value={Number.isFinite(options[key]) ? options[key] : ""}
                    onChange={(event) =>
                      setOptions((current) => ({
                        ...current,
                        [key]:
                          event.target.value === ""
                            ? NaN
                            : Number(event.target.value),
                      }))
                    }
                  />
                  <small>
                    {min}–{max}
                  </small>
                </label>
              ))}
            </div>
            {!configValid && (
              <p className="task-manager-error" role="status">
                {t("taskManager.alertInvalid")}
              </p>
            )}
            {options.enabled && configValid && (
              <p className="task-manager-hint">
                {t("taskManager.alertRules", {
                  values: {
                    cpu: options.cpuPercent,
                    memory: options.memoryMiB,
                    duration: options.durationSecs,
                  },
                })}
              </p>
            )}
            {options.enabled && (
              <p className="task-manager-hint">
                {t(
                  samplingActive && valid
                    ? "taskManager.alertMonitoring"
                    : "taskManager.alertWaiting",
                )}
              </p>
            )}
          </div>
        </details>
      )}
      {mode !== "panel-only" &&
        (["cpu", "memory"] as const).map(
          (metric) =>
            alerts[metric].active &&
            !alerts[metric].dismissed && (
              <div
                key={metric}
                className="task-manager-alert-notice"
                role="status"
                data-alert-metric={metric}
              >
                <span>
                  {t("taskManager.alertTriggered", {
                    values: {
                      metric: t(
                        metric === "cpu"
                          ? "taskManager.visibleCpu"
                          : "taskManager.visibleMemory",
                      ),
                      threshold:
                        metric === "cpu"
                          ? `${options.cpuPercent}%`
                          : `${options.memoryMiB} MiB`,
                      duration: options.durationSecs,
                    },
                  })}
                </span>
                <button
                  type="button"
                  className="task-manager-refresh-btn"
                  onClick={() => dismiss(metric)}
                >
                  {t("taskManager.dismissAlert")}
                </button>
              </div>
            ),
        )}
    </>
  );
}
