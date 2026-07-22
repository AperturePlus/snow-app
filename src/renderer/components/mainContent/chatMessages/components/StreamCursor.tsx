import { memo } from "react";

/**
 * Pulsing dot that marks the AI response as actively streaming.
 * Real-time metrics (elapsed time, tok/s, TTFT) are displayed in the
 * fixed StreamMetrics bar above the input box, not here.
 */
export const StreamCursor = memo(
  (): React.JSX.Element => (
    <span className="stream-cursor" aria-hidden="true">
      <span className="stream-cursor-dot" />
    </span>
  )
);

StreamCursor.displayName = "StreamCursor";
