import { useState } from "react";
import { Check, Copy, Undo2 } from "lucide-react";
type UserMessageActionsProps = {
  content: string;
  isStreaming: boolean;
  onRollback: () => void;
};

export const UserMessageActions = ({
  content,
  isStreaming,
  onRollback,
}: UserMessageActionsProps): React.JSX.Element => {
  const [copied, setCopied] = useState(false);

  const handleCopy = (): void => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="user-message-actions" aria-label="User message actions">
      <button
        className="user-message-action-btn"
        type="button"
        aria-label="Copy user message"
        onClick={handleCopy}
      >
        {copied ? (
          <Check size={15} strokeWidth={1.8} />
        ) : (
          <Copy size={15} strokeWidth={1.8} />
        )}
      </button>
      {!isStreaming ? (
        <button
          className="user-message-action-btn"
          type="button"
          aria-label="Rollback to this message"
          onClick={onRollback}
        >
          <Undo2 size={15} strokeWidth={1.8} />
        </button>
      ) : null}
    </div>
  );
};
