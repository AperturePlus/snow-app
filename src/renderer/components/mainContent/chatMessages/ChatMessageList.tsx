import { Wrench, CheckCircle, Loader2, AlertCircle } from "lucide-react";
import { AiResponse } from "./AiResponse";
import { UserMessage } from "./UserMessage";
import type { ChatConversationMessage, ToolCallInfo } from "./useChatConversation";

type ChatMessageListProps = {
  messages: ChatConversationMessage[];
};

const ToolCallItem = ({ toolCall }: { toolCall: ToolCallInfo }): React.JSX.Element => {
  const iconName = toolCall.name.replace(/^mcp__.*__/, "");
  const StatusIcon =
    toolCall.status === "completed"
      ? CheckCircle
      : toolCall.status === "running"
        ? Loader2
        : toolCall.status === "error"
          ? AlertCircle
          : Wrench;

  return (
    <div className="tool-call-item">
      <div className="tool-call-header">
        <StatusIcon
          size={14}
          className={
            toolCall.status === "running" ? "tool-call-icon-spinning" : ""
          }
          aria-hidden="true"
        />
        <span className="tool-call-name">{iconName}</span>
        <span className={`tool-call-status tool-call-status-${toolCall.status}`}>
          {toolCall.status}
        </span>
      </div>
      {toolCall.result ? (
        <details className="tool-call-result">
          <summary>Result</summary>
          <pre>{toolCall.result}</pre>
        </details>
      ) : null}
    </div>
  );
};

const ToolMessage = ({
  toolName,
  content,
}: {
  toolName?: string;
  content: string;
}): React.JSX.Element => (
  <div className="chat-message-tool">
    <div className="tool-message-header">
      <Wrench size={14} aria-hidden="true" />
      <span>{toolName || "Tool Result"}</span>
    </div>
    <pre className="tool-message-content">{content}</pre>
  </div>
);

export const ChatMessageList = ({
  messages,
}: ChatMessageListProps): React.JSX.Element => (
  <div className="chat-message-list">
    {messages.map((message) => {
      if (message.role === "user") {
        return <UserMessage content={message.content} key={message.id} />;
      }

      if (message.role === "tool") {
        return (
          <ToolMessage
            key={message.id}
            toolName={message.toolName}
            content={message.content}
          />
        );
      }

      const className = `chat-message-group ${
        message.status ? `is-${message.status}` : ""
      }`.trim();

      return (
        <div className={className} key={message.id}>
          {message.toolCalls && message.toolCalls.length > 0 ? (
            <div className="tool-calls-container">
              {message.toolCalls.map((toolCall, index) => (
                <ToolCallItem key={`${toolCall.name}-${index}`} toolCall={toolCall} />
              ))}
            </div>
          ) : null}
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
