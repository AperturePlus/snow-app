import { useMemo, useState } from "react";
import type { TokenUsage } from "../../../../preload";

type TokenUsageRingProps = {
  tokenUsage: TokenUsage | null;
  maxContextTokens?: number | null;
};

const RING_SIZE = 18;
const STROKE_WIDTH = 2.5;
const RADIUS = (RING_SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export const TokenUsageRing = ({
  tokenUsage,
  maxContextTokens,
}: TokenUsageRingProps): React.JSX.Element | null => {
  const [showTooltip, setShowTooltip] = useState(false);

  const segments = useMemo(() => {
    if (!tokenUsage) {
      return null;
    }

    const input = tokenUsage.inputTokens;
    const output = tokenUsage.outputTokens;
    const cacheCreation = tokenUsage.cacheCreationInputTokens;
    const cacheRead = tokenUsage.cacheReadInputTokens;

    // input_tokens is normalized at the Rust layer to include cache tokens for
    // all providers (Anthropic returns them disjoint; OpenAI/Gemini already
    // include them in prompt_tokens). So total = input + output is correct.
    const total = input + output;

    if (total === 0) {
      return null;
    }

    const max =
      maxContextTokens && maxContextTokens > 0 ? maxContextTokens : total;
    const ratio = Math.min(total / max, 1);
    const filled = ratio * CIRCUMFERENCE;
    const remaining = CIRCUMFERENCE - filled;

    // Non-cached input = input minus the portion that was a cache hit.
    const nonCachedInput = Math.max(0, input - cacheRead);

    const inputLength = filled * (nonCachedInput / total);
    const outputLength = filled * (output / total);
    const cacheLength = filled * (cacheRead / total);

    return {
      input,
      output,
      cacheCreation,
      cacheRead,
      nonCachedInput,
      total,
      max,
      ratio,
      filled,
      remaining,
      inputLength,
      outputLength,
      cacheLength,
    };
  }, [tokenUsage, maxContextTokens]);

  if (!segments) {
    return null;
  }

  const tooltipContent = (
    <div className="token-usage-tooltip">
      <div className="token-usage-tooltip-row">
        <span className="token-usage-dot token-usage-dot-input" />
        <span className="token-usage-label">Input</span>
        <span className="token-usage-value">
          {segments.input.toLocaleString()}
        </span>
      </div>
      <div className="token-usage-tooltip-row">
        <span className="token-usage-dot token-usage-dot-output" />
        <span className="token-usage-label">Output</span>
        <span className="token-usage-value">
          {segments.output.toLocaleString()}
        </span>
      </div>
      {segments.cacheCreation > 0 && (
        <div className="token-usage-tooltip-row">
          <span className="token-usage-dot token-usage-dot-cache" />
          <span className="token-usage-label">Cache Write</span>
          <span className="token-usage-value">
            {segments.cacheCreation.toLocaleString()}
          </span>
        </div>
      )}
      {segments.cacheRead > 0 && (
        <div className="token-usage-tooltip-row">
          <span className="token-usage-dot token-usage-dot-cache-read" />
          <span className="token-usage-label">Cache Read</span>
          <span className="token-usage-value">
            {segments.cacheRead.toLocaleString()}
          </span>
        </div>
      )}
      <div className="token-usage-tooltip-divider" />
      <div className="token-usage-tooltip-row">
        <span className="token-usage-label">Total</span>
        <span className="token-usage-value">
          {segments.total.toLocaleString()}
        </span>
      </div>
      {maxContextTokens && maxContextTokens > 0 && (
        <div className="token-usage-tooltip-row">
          <span className="token-usage-label">Context</span>
          <span className="token-usage-value">
            {segments.max.toLocaleString()}
          </span>
        </div>
      )}
    </div>
  );

  return (
    <div
      className="token-usage-ring-wrapper"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <svg
        width={RING_SIZE}
        height={RING_SIZE}
        viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
        className="token-usage-ring"
      >
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE_WIDTH}
          className="token-usage-ring-bg"
        />
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE_WIDTH}
          className="token-usage-ring-input"
          strokeDasharray={`${segments.inputLength} ${
            CIRCUMFERENCE - segments.inputLength
          }`}
          strokeDashoffset={0}
        />
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE_WIDTH}
          className="token-usage-ring-output"
          strokeDasharray={`${segments.outputLength} ${
            CIRCUMFERENCE - segments.outputLength
          }`}
          strokeDashoffset={-segments.inputLength}
        />
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE_WIDTH}
          className="token-usage-ring-cache"
          strokeDasharray={`${segments.cacheLength} ${
            CIRCUMFERENCE - segments.cacheLength
          }`}
          strokeDashoffset={-(segments.inputLength + segments.outputLength)}
        />
      </svg>
      <span className="token-usage-ring-text">
        {(segments.ratio * 100).toFixed(1)}%
      </span>
      {showTooltip && tooltipContent}
    </div>
  );
};
