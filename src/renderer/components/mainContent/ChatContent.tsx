import type { WorkspaceDirectoryRecord } from "../../../preload";
import { ChatInput } from "./ChatInput";
import { EmptyGreeting } from "./EmptyGreeting";
import { ChatMessageList, useMockChatConversation } from "./chatMessages";

type ChatContentProps = {
  activeDirectory?: WorkspaceDirectoryRecord | null;
};

export const ChatContent = ({
  activeDirectory,
}: ChatContentProps): React.JSX.Element => {
  const { messages, handleSendMessage } = useMockChatConversation();
  const hasMessages = messages.length > 0;

  return (
    <>
      <div className="chat-area">
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
