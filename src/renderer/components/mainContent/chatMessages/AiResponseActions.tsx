import { useState } from "react";
import { Check, Copy, GitFork } from "lucide-react";
import { useI18n } from "../../../i18n";

export type AiResponseActionsProps = {
  content: string;
  conversationId: string;
  responseId?: string;
  onFork: (conversationId: string, upToResponseId: string) => void;
};

export const AiResponseActions = ({
  content,
  conversationId,
  responseId,
  onFork,
}: AiResponseActionsProps): React.JSX.Element => {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const handleCopy = (): void => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleFork = (): void => {
    onFork(conversationId, responseId ?? "");
  };

  return (
    <div className="ai-response-actions" aria-label="AI response actions">
      <button
        className="ai-response-action-btn"
        type="button"
        aria-label={t("chat.copyResponse", { defaultValue: "Copy" })}
        onClick={handleCopy}
      >
        {copied ? (
          <Check size={15} strokeWidth={1.8} />
        ) : (
          <Copy size={15} strokeWidth={1.8} />
        )}
      </button>
      <button
        className="ai-response-action-btn"
        type="button"
        aria-label={t("chat.forkConversation", { defaultValue: "Fork" })}
        onClick={handleFork}
      >
        <GitFork size={15} strokeWidth={1.8} />
      </button>
    </div>
  );
};
