import { useEffect, useRef } from "react";
import type { WorkspaceDirectoryRecord } from "../../../preload";
import { ChatInput } from "./ChatInput";
import { EmptyGreeting } from "./EmptyGreeting";
import { ChatMessageList, useChatConversation } from "./chatMessages";

type ChatContentProps = {
  activeDirectory?: WorkspaceDirectoryRecord | null;
};

export const ChatContent = ({
  activeDirectory,
}: ChatContentProps): React.JSX.Element => {
  const { messages, handleSendMessage } = useChatConversation();
  const chatAreaRef = useRef<HTMLDivElement>(null);
  const hasMessages = messages.length > 0;

  useEffect(() => {
    chatAreaRef.current?.scrollTo({
      top: chatAreaRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  return (
    <>
      <div className="chat-area" ref={chatAreaRef}>
        {hasMessages ? (
          <ChatMessageList messages={messages} />
        ) : (
          <EmptyGreeting activeDirectory={activeDirectory} />
        )}
      </div>

      <ChatInput onSend={handleSendMessage} />
    </>
  );
};
