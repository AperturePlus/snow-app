import { Clock, X } from "lucide-react";
import { useI18n } from "../../../i18n";

type PendingMessagesProps = {
  messages: string[];
  onWithdraw?: (index: number) => string | null;
};

export const PendingMessages = ({
  messages,
  onWithdraw,
}: PendingMessagesProps): React.JSX.Element | null => {
  const { t } = useI18n();

  if (messages.length === 0) {
    return null;
  }

  const handleWithdraw = (index: number) => {
    if (!onWithdraw) {
      return;
    }
    const restored = onWithdraw(index);
    if (!restored) {
      return;
    }
  };

  return (
    <div className="pending-messages-area" role="status" aria-live="polite">
      <div className="pending-messages-header">
        <Clock size={12} className="pending-messages-icon" />
        <span>{t("chatInput.pendingLabel")}</span>
      </div>
      <ul className="pending-messages-list">
        {messages.map((msg, index) => (
          <li key={index} className="pending-message-item">
            <span className="pending-message-text">{msg}</span>
            {onWithdraw && (
              <button
                type="button"
                className="pending-message-withdraw"
                onClick={() => handleWithdraw(index)}
                aria-label={t("chatInput.withdraw")}
                title={t("chatInput.withdraw")}
              >
                <X size={12} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};
