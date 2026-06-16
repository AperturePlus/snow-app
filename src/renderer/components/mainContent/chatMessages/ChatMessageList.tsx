import { AiResponse } from "./AiResponse";
import { UserMessage } from "./UserMessage";
import type { ChatConversationMessage } from "./useMockChatConversation";

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

      return (
        <div className="chat-message-group" key={message.id}>
          <AiResponse title="AI 响应" summary={<p>{message.content}</p>} />
        </div>
      );
    })}
  </div>
);
