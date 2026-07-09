import { Copy, Undo2 } from "lucide-react";

type UserMessageActionsProps = {
  content: string;
  onRollback: () => void;
};

export const UserMessageActions = ({
  content,
  onRollback,
}: UserMessageActionsProps): React.JSX.Element => {
  const handleCopy = (): void => {
    void navigator.clipboard.writeText(content);
  };

  return (
    <div className="user-message-actions" aria-label="User message actions">
      <button
        className="user-message-action-btn"
        type="button"
        aria-label="Copy user message"
        onClick={handleCopy}
      >
        <Copy size={15} strokeWidth={1.8} />
      </button>
      <button
        className="user-message-action-btn"
        type="button"
        aria-label="Rollback to this message"
        onClick={onRollback}
      >
        <Undo2 size={15} strokeWidth={1.8} />
      </button>
    </div>
  );
};
