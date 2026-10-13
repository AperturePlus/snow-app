import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import {
  appendUsageSample,
  pruneUsageSamples,
  usageSegments,
  TREND_WINDOW_MS,
  CONTINUOUS_SAMPLE_GAP_MS,
  type SampleStamp,
  type UsageSample,
} from "./taskManagerMonitoring";
import type { summarizeProcesses } from "./taskManagerModel";

export type TaskManagerTrendProps = {
  stamp: SampleStamp | null;
  scopeKey: string;
  summary: ReturnType<typeof summarizeProcesses>;
  scopeKnown: boolean;
  continuity: number;
  now: number;
};

/** Scope changes clear the buffer and consume the old stamp without adding another point. */
export function useUsageTrend({
  stamp,
  scopeKey,
  summary,
  scopeKnown,
  continuity,
  now,
}: TaskManagerTrendProps) {
  const [samples, setSamples] = useState<UsageSample[]>([]);
  const scopeRef = useRef(scopeKey);
  const consumedRef = useRef(stamp?.id ?? 0);
  const previousContinuityRef = useRef<number | null>(null);
  const previousAtRef = useRef<number | null>(null);
  useEffect(() => {
    if (scopeRef.current !== scopeKey) {
      scopeRef.current = scopeKey;
      consumedRef.current = stamp?.id ?? 0;
      previousContinuityRef.current = null;
      previousAtRef.current = null;
      setSamples([]);
      return;
    }
    if (!stamp || stamp.id <= consumedRef.current) return;
    consumedRef.current = stamp.id;
    if (stamp.scopeKey !== scopeKey) return;
    const broken =
      previousContinuityRef.current !== stamp.continuity ||
      stamp.continuity !== continuity ||
      previousAtRef.current == null ||
      stamp.atMs - previousAtRef.current > CONTINUOUS_SAMPLE_GAP_MS;
    previousContinuityRef.current = stamp.continuity;
    previousAtRef.current = stamp.atMs;
    const sample: UsageSample = {
      atMs: stamp.atMs,
      cpu:
        scopeKnown &&
        !broken &&
        summary.count > 0 &&
        summary.cpuSamples === summary.count
          ? summary.cpu
          : null,
      memory: scopeKnown ? summary.memory : null,
      breakBefore: broken,
    };
    setSamples((previous) => appendUsageSample(previous, sample));
  }, [stamp, scopeKey, summary, scopeKnown, continuity]);
  useEffect(() => {
    setSamples((previous) => {
      const retained = pruneUsageSamples(previous, now);
      return retained.length === previous.length ? previous : retained;
    });
  }, [now]);
  return scopeRef.current === scopeKey ? samples : [];
}

function UsageChart({
  samples,
  metric,
  now,
}: {
  samples: UsageSample[];
  metric: "cpu" | "memory";
  now: number;
}) {
  const { t, locale } = useI18n();
  const values = samples.flatMap((sample) =>
    sample[metric] == null ? [] : [sample[metric]!],
  );
  const scaleMax =
    metric === "cpu" ? Math.max(100, ...values) : Math.max(1048576, ...values);
  const latest = samples.at(-1)?.[metric];
  const label =
    metric === "cpu" ? t("taskManager.ownCpu") : t("taskManager.ownMemory");
  const format = (value: number | null | undefined): string =>
    value == null
      ? t("taskManager.trendUnknown")
      : metric === "cpu"
        ? `${value.toFixed(1)}%`
        : `${(value / 1048576).toFixed(1)} MiB`;
  const x = (atMs: number): number =>
    8 +
    Math.max(
      0,
      Math.min(1, (atMs - (now - TREND_WINDOW_MS)) / TREND_WINDOW_MS),
    ) *
      304;
  const y = (value: number): number => 66 - (value / scaleMax) * 54;
  const segments = usageSegments(samples, metric);
  return (
    <figure className={`task-manager-chart task-manager-chart-${metric}`}>
      <figcaption>
        <span>{label}</span>
        <strong>{format(latest)}</strong>
      </figcaption>
      <svg
        viewBox="0 0 320 84"
        role="img"
        aria-label={t("taskManager.trendChartLabel", {
          values: { metric: label, value: format(latest) },
        })}
      >
        <title>
          {t("taskManager.trendChartLabel", {
            values: { metric: label, value: format(latest) },
          })}
        </title>
        <path className="task-manager-chart-axis" d="M8 12H312 M8 66H312" />
        {segments.map((segment, index) => (
          <g key={index}>
            {segment.length > 1 && (
              <path
                className="task-manager-chart-line"
                d={segment
                  .map(
                    (point, i) =>
                      `${i ? "L" : "M"}${x(point.atMs).toFixed(2)} ${y(point[metric]!).toFixed(2)}`,
                  )
                  .join(" ")}
              />
            )}
            {segment.map((point) => (
              <circle
                key={point.atMs}
                className="task-manager-chart-point"
                cx={x(point.atMs)}
                cy={y(point[metric]!)}
                r={1.8}
              >
                <title>
                  {new Date(point.atMs).toLocaleTimeString(locale)} ·{" "}
                  {format(point[metric])}
                </title>
              </circle>
            ))}
          </g>
        ))}
        <text x="8" y="80">
          −60 s
        </text>
        <text x="312" y="80" textAnchor="end">
          {new Date(now).toLocaleTimeString(locale)}
        </text>
      </svg>
      <span className="task-manager-chart-scale">
        {t("taskManager.trendScale", { values: { value: format(scaleMax) } })}
      </span>
    </figure>
  );
}

export function TaskManagerTrend(props: {
  samples: UsageSample[];
  now: number;
}): React.JSX.Element {
  const { t } = useI18n();
  const samples = props.samples;
  return (
    <details
      className="task-manager-disclosure task-manager-trend"
      data-testid="task-manager-trend"
    >
      <summary>{t("taskManager.trendTitle")}</summary>
      <div className="task-manager-trend-body">
        <p className="task-manager-hint">{t("taskManager.trendHint")}</p>
        {!samples.length ? (
          <p className="task-manager-hint">{t("taskManager.trendEmpty")}</p>
        ) : (
          <div className="task-manager-charts">
            <UsageChart samples={samples} metric="cpu" now={props.now} />
            <UsageChart samples={samples} metric="memory" now={props.now} />
          </div>
        )}
      </div>
    </details>
  );
}
