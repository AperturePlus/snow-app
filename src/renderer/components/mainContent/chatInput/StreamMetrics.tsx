import { ArrowDown, Clock, Gauge, Timer } from "lucide-react";
import { memo, useEffect, useState } from "react";

export type StreamMetricsProps = {
  tokenCount: number;
  elapsedMs: number;
  ttftMs: number;
  /** Wall-clock timestamp (Date.now()) captured once when an agent loop
   *  starts, sourced from the active conversation session state. Drives the
   *  accumulating elapsed timer so it survives conversation switches between
   *  parallel streaming sessions. 0 when the loop is finished. */
  startedAt: number;
};

const formatTokenCount = (count: number): string =>
  count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count);

const formatDuration = (ms: number): string => {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m${remainingSeconds}s`;
};

const formatTtft = (ms: number): string => {
  if (ms <= 0) return "--";
  const seconds = Math.round(ms / 1000);
  if (seconds < 1) return "<1s";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m${remainingSeconds}s`;
};

const formatTokPerSec = (tokens: number, elapsedMs: number): string => {
  if (elapsedMs <= 0 || tokens <= 0) return "--";
  const tps = (tokens / elapsedMs) * 1000;
  return tps >= 100 ? `${Math.round(tps)}` : tps.toFixed(1);
};

/**
 * Fixed streaming metrics bar displayed above the input box while the AI
 * is generating a response. Shows token count, elapsed time, TTFT, and
 * tokens/sec in real time.
 *
 * The elapsed timer is driven by `startedAt` — a wall-clock timestamp the
 * agent loop captures once when it begins and resets to 0 when it ends.
 * This keeps the timer independent of the backend's per-iteration
 * `elapsedMs` (which resets on every createResponseStream call) and lets
 * each parallel streaming conversation carry its own anchor, so switching
 * between them no longer resets the timer.
 */
export const StreamMetrics = memo(
  ({
    tokenCount,
    elapsedMs,
    ttftMs,
    startedAt,
  }: StreamMetricsProps): React.JSX.Element => {
    const hasTtft = typeof ttftMs === "number" && ttftMs > 0;
    const isActive = typeof startedAt === "number" && startedAt > 0;

    // Derive the accumulated elapsed time purely from `startedAt`. The anchor
    // lives in session state, so switching conversations swaps it atomically
    // without any local ref bookkeeping. A 500ms interval keeps the display
    // ticking; it re-subscribes whenever the anchor changes (new send, switch).
    const [localElapsed, setLocalElapsed] = useState(0);

    useEffect(() => {
      if (!isActive) {
        setLocalElapsed(0);
        return;
      }

      setLocalElapsed(Date.now() - startedAt);
      const interval = setInterval(() => {
        setLocalElapsed(Date.now() - startedAt);
      }, 500);

      return () => clearInterval(interval);
    }, [isActive, startedAt]);

    const elapsedDisplay = formatDuration(localElapsed);
    const hasTokens = tokenCount > 0;
    const tps =
      tokenCount > 0 && elapsedMs > 0
        ? formatTokPerSec(tokenCount, elapsedMs)
        : "--";
    const hasTps = tps !== "--";

    return (
      <span className="stream-metrics">
        <span
          className={`stream-metrics-metric stream-metrics-elapsed${
            isActive ? " is-active" : ""
          }`}
        >
          <Timer size={11} className="stream-metrics-icon" />
          <span className="stream-metrics-value">{elapsedDisplay}</span>
        </span>
        <span className="stream-metrics-sep" />
        <span className="stream-metrics-metric stream-metrics-ttft">
          <Clock size={11} className="stream-metrics-icon" />
          <span className="stream-metrics-value">
            {hasTtft ? formatTtft(ttftMs) : "--"}
          </span>
        </span>
        <span className="stream-metrics-sep" />
        <span
          className={`stream-metrics-metric stream-metrics-tokens${
            hasTokens ? " is-active" : ""
          }`}
        >
          <ArrowDown size={11} className="stream-metrics-icon" />
          <span className="stream-metrics-value">
            {formatTokenCount(tokenCount)}
          </span>
          <span className="stream-metrics-label">tokens</span>
        </span>
        <span className="stream-metrics-sep" />
        <span
          className={`stream-metrics-metric stream-metrics-tps${
            hasTps ? " is-active" : ""
          }`}
        >
          <Gauge size={11} className="stream-metrics-icon" />
          <span className="stream-metrics-value">{tps}</span>
          <span className="stream-metrics-label">tok/s</span>
        </span>
      </span>
    );
  }
);

StreamMetrics.displayName = "StreamMetrics";
