import { ArrowUp, Clock, Trash2 } from "lucide-react";
import { useI18n } from "../../../i18n";

type PendingMessagesProps = {
  messages: string[];
  onWithdraw?: (index: number) => string | null;
  onSendNow?: (index: number) => void;
};

export const PendingMessages = ({
  messages,
  onWithdraw,
  onSendNow,
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

  const handleSendNow = (index: number) => {
    if (!onSendNow) {
      return;
    }
    onSendNow(index);
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
            {onSendNow && (
              <button
                type="button"
                className="pending-message-send-now"
                onClick={() => handleSendNow(index)}
                aria-label={t("chatInput.sendNow")}
                title={t("chatInput.sendNow")}
              >
                <ArrowUp size={12} />
              </button>
            )}
            {onWithdraw && (
              <button
                type="button"
                className="pending-message-withdraw"
                onClick={() => handleWithdraw(index)}
                aria-label={t("chatInput.withdraw")}
                title={t("chatInput.withdraw")}
              >
                <Trash2 size={12} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};
