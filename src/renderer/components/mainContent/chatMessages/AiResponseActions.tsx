import { Copy, MoreHorizontal, RotateCcw } from "lucide-react";

export const AiResponseActions = (): React.JSX.Element => (
  <div className="ai-response-actions" aria-label="AI response actions">
    <button className="ai-response-action-btn" type="button" aria-label="Copy AI response">
      <Copy size={15} strokeWidth={1.8} />
    </button>
    <button className="ai-response-action-btn" type="button" aria-label="Regenerate AI response">
      <RotateCcw size={15} strokeWidth={1.8} />
    </button>
    <button className="ai-response-action-btn" type="button" aria-label="More AI response actions">
      <MoreHorizontal size={16} strokeWidth={1.8} />
    </button>
  </div>
);
