import { Copy, MoreHorizontal, Pencil } from "lucide-react";

export const UserMessageActions = (): React.JSX.Element => (
  <div className="user-message-actions" aria-label="User message actions">
    <button className="user-message-action-btn" type="button" aria-label="Copy user message">
      <Copy size={15} strokeWidth={1.8} />
    </button>
    <button className="user-message-action-btn" type="button" aria-label="Edit user message">
      <Pencil size={15} strokeWidth={1.8} />
    </button>
    <button className="user-message-action-btn" type="button" aria-label="More user message actions">
      <MoreHorizontal size={16} strokeWidth={1.8} />
    </button>
  </div>
);
