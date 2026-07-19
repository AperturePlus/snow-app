import { ArrowDown } from "lucide-react";
import { memo } from "react";

export type StreamCursorProps = {
  /**
   * Cumulative token count produced by the Rust backend for the current
   * streaming iteration. When greater than zero the count is rendered next
   * to the pulsing dot so users can perceive streaming progress directly
   * inside the AI response rather than only in the input toolbar.
   */
  tokenCount?: number;
};

const formatTokenCount = (count: number): string =>
  count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count);

/**
 * Pulsing dot that marks the AI response as actively streaming. When a
 * token count is available it is rendered inline so the progress is
 * visible directly at the tail of the message body.
 */
export const StreamCursor = memo(
  ({ tokenCount }: StreamCursorProps): React.JSX.Element => {
    const hasTokens = typeof tokenCount === "number" && tokenCount > 0;

    return (
      <span className="stream-cursor" aria-hidden="true">
        <span className="stream-cursor-dot" />
        {hasTokens ? (
          <span className="stream-cursor-tokens">
            <ArrowDown size={11} className="stream-cursor-tokens-icon" />
            <span className="stream-cursor-tokens-value">
              {formatTokenCount(tokenCount as number)}
            </span>
            <span className="stream-cursor-tokens-label">tokens</span>
          </span>
        ) : null}
      </span>
    );
  }
);

StreamCursor.displayName = "StreamCursor";
