import { useState } from "react";
import { Check, Copy, RotateCcw } from "lucide-react";
import { useI18n } from "../../../i18n";

export type UserMessageActionsProps = {
  content: string;
  messageId: string;
  onRollback: (messageId: string) => void;
  disabled?: boolean;
};

export const UserMessageActions = ({
  content,
  messageId,
  onRollback,
  disabled = false,
}: UserMessageActionsProps): React.JSX.Element => {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const handleCopy = (): void => {
    void navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleRollback = (): void => {
    if (disabled) {
      return;
    }
    onRollback(messageId);
  };

  return (
    <div className="user-message-actions" aria-label="User message actions">
      <button
        className="user-message-action-btn"
        type="button"
        aria-label={t("chat.copyUserMessage", { defaultValue: "Copy" })}
        onClick={handleCopy}
      >
        {copied ? (
          <Check size={15} strokeWidth={1.8} />
        ) : (
          <Copy size={15} strokeWidth={1.8} />
        )}
      </button>
      <button
        className="user-message-action-btn"
        type="button"
        aria-label={t("chat.rollbackMessage", { defaultValue: "Rollback" })}
        onClick={handleRollback}
        disabled={disabled}
      >
        <RotateCcw size={15} strokeWidth={1.8} />
      </button>
    </div>
  );
};
