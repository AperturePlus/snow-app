import { ChatInputView } from "./chatInput/ChatInputView";
import { useChatInputController } from "./chatInput/useChatInputController";
import type { ChatInputProps } from "./chatInput/types";
import { useI18n } from "../../i18n";

export const ChatInput = ({
  placeholder,
  onSend,
  isStreaming = false,
  onAbort,
  tokenUsage = null,
  draftToRestore = null,
  onDraftRestored,
}: ChatInputProps): React.JSX.Element => {
  const { t } = useI18n();
  const controller = useChatInputController({
    onSend,
    isStreaming,
    onAbort,
    draftToRestore,
    onDraftRestored,
  });

  return (
    <ChatInputView
      placeholder={placeholder ?? t("chatInput.placeholder")}
      {...controller}
      tokenUsage={tokenUsage}
    />
  );
};
