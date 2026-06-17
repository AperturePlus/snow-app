import { AiResponse } from "./AiResponse";
import { UserMessage } from "./UserMessage";
import type { ChatConversationMessage } from "./useChatConversation";

type ChatMessageListProps = {
  messages: ChatConversationMessage[];
};

export const ChatMessageList = ({
  messages,
}: ChatMessageListProps): React.JSX.Element => (
  <div className="chat-message-list">
    {messages.map((message) => {
      if (message.role === "user") {
        return <UserMessage content={message.content} key={message.id} />;
      }

      const className = `chat-message-group ${
        message.status ? `is-${message.status}` : ""
      }`.trim();

      return (
        <div className={className} key={message.id}>
          <AiResponse
            isStreaming={message.status === "sending"}
            summary={message.content}
            thinking={message.thinking}
          />
        </div>
      );
    })}
  </div>
);
