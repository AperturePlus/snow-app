import { ArrowDown, Clock, Gauge, Timer } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";

export type StreamMetricsProps = {
  tokenCount: number;
  elapsedMs: number;
  ttftMs: number;
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
 */
export const StreamMetrics = memo(
  ({
    tokenCount,
    elapsedMs,
    ttftMs,
  }: StreamMetricsProps): React.JSX.Element => {
    const hasElapsed = typeof elapsedMs === "number" && elapsedMs > 0;
    const hasTtft = typeof ttftMs === "number" && ttftMs > 0;

    // Accumulating elapsed timer. The timer starts when streaming begins
    // and keeps ticking across all agent-loop iterations (including tool
    // calls between streams) until the loop is completely finished. We
    // anchor a wall-clock start time so the timer is independent of the
    // backend's per-iteration elapsedMs, which resets on every new
    // createResponseStream call.
    const [localElapsed, setLocalElapsed] = useState(0);
    const startTimeRef = useRef<number | null>(null);

    useEffect(() => {
      if (!hasElapsed) {
        setLocalElapsed(0);
        startTimeRef.current = null;
        return;
      }

      // Initialize the start anchor only once, when streaming begins.
      if (startTimeRef.current === null) {
        startTimeRef.current = Date.now() - elapsedMs;
        setLocalElapsed(elapsedMs);
      }

      const interval = setInterval(() => {
        if (startTimeRef.current !== null) {
          setLocalElapsed(Date.now() - startTimeRef.current);
        }
      }, 500);

      return () => clearInterval(interval);
      // Intentionally exclude elapsedMs: the timer must not re-sync
      // (and reset) when the backend sends a new per-iteration value.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hasElapsed]);

    const displayElapsed = hasElapsed ? localElapsed : 0;
    const elapsedDisplay = formatDuration(displayElapsed);
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
            hasElapsed ? " is-active" : ""
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
