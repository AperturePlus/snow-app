import { ChatInputView } from "./chatInput/ChatInputView";
import { useChatInputController } from "./chatInput/useChatInputController";
import type { ChatInputProps } from "./chatInput/types";
import { useI18n } from "../../i18n";

export const ChatInput = ({
  placeholder,
  onSend,
  isStreaming = false,
  isAborting = false,
  onAbort,
  tokenUsage = null,
  draftToRestore = null,
  onDraftRestored,
  pendingMessages = [],
  onWithdrawPendingMessage,
  onCompactConversation,
  yoloMode = false,
  isUpdatingYoloMode = false,
  onYoloModeChange,
  onRefreshYoloMode,
  autoScrollEnabled = false,
  onAutoScrollChange,
  isCompacting = false,
}: ChatInputProps): React.JSX.Element => {
  const { t } = useI18n();
  const controller = useChatInputController({
    onSend,
    isStreaming,
    isAborting,
    onAbort,
    draftToRestore,
    onDraftRestored,
  });

  return (
    <ChatInputView
      placeholder={placeholder ?? t("chatInput.placeholder")}
      {...controller}
      tokenUsage={tokenUsage}
      pendingMessages={pendingMessages}
      onWithdrawPendingMessage={onWithdrawPendingMessage}
      onCompactConversation={onCompactConversation}
      yoloMode={yoloMode}
      isUpdatingYoloMode={isUpdatingYoloMode}
      onYoloModeChange={onYoloModeChange}
      onRefreshYoloMode={onRefreshYoloMode}
      autoScrollEnabled={autoScrollEnabled}
      onAutoScrollChange={onAutoScrollChange}
      isCompacting={isCompacting}
    />
  );
};
