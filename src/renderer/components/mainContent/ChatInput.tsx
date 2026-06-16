import { ChatInputView } from "./chatInput/ChatInputView";
import { useChatInputController } from "./chatInput/useChatInputController";
import type { ChatInputProps } from "./chatInput/types";

export const ChatInput = ({
  placeholder = "Ask for follow-up changes",
  onSend,
}: ChatInputProps): React.JSX.Element => {
  const controller = useChatInputController({ onSend });

  return <ChatInputView placeholder={placeholder} {...controller} />;
};
