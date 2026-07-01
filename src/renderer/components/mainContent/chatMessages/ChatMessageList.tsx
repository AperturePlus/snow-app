import { useMemo } from "react";
import { AiResponse } from "./AiResponse";
import { UserMessage } from "./UserMessage";
import type { ChatConversationMessage } from "./useChatConversation";

type ChatMessageListProps = {
  messages: ChatConversationMessage[];
  isStreaming: boolean;
  isAborting: boolean;
};

export const ChatMessageList = ({
  messages,
  isStreaming,
  isAborting,
}: ChatMessageListProps): React.JSX.Element => {
  const lastAssistantMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") {
        return messages[i].id;
      }
    }
    return undefined;
  }, [messages]);

  return (
    <div className="chat-message-list">
      {messages.map((message) => {
        if (message.role === "user") {
          return <UserMessage content={message.content} key={message.id} />;
        }

        // Skip standalone tool messages — their results are already
        // rendered inside the preceding assistant message's ToolCallItem.
        if (message.role === "tool") {
          return null;
        }

        const className = `chat-message-group ${
          message.status ? `is-${message.status}` : ""
        }`.trim();

        const isLastAssistant = message.id === lastAssistantMessageId;
        const showActions = isLastAssistant && !isStreaming;

        return (
          <div className={className} key={message.id}>
            <AiResponse
              isStreaming={message.status === "sending"}
              isAborting={isLastAssistant && isAborting}
              summary={message.content}
              thinking={message.thinking}
              showActions={showActions}
              toolCalls={message.toolCalls}
            />
          </div>
        );
      })}
    </div>
  );
};
