import { useMemo } from "react";
import { GitFork } from "lucide-react";
import { useI18n } from "../../../../i18n";
import { AiResponse } from "./AiResponse";
import { CompactionMessage } from "./CompactionMessage";
import { UserMessage } from "./UserMessage";
import type { ChatConversationMessage } from "../utils/conversationTypes";
import { useChatConversationContext } from "./ChatConversationContext";

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
  const { t } = useI18n();
  const {
    activeConversationId,
    handleForkConversation,
    handleSelectConversation,
    handleRollback,
    forkedFromConversationId,
    forkMessageCount,
    pendingToolAuthorizations,
    approveToolAuthorization,
    approveToolAuthorizationAlways,
    rejectToolAuthorization,
    streamTokenCount,
  } = useChatConversationContext();

  const lastAssistantMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") {
        return messages[i].id;
      }
    }
    return undefined;
  }, [messages]);

  // The fork divider should appear after the fork point (the messages
  // copied from the source conversation), not after all messages.
  // forkMessageCount records how many messages were copied at fork time.
  // Rendered messages exclude tool-role messages, so we need to count
  // visible messages up to that point.
  const forkDividerIndex = useMemo(() => {
    if (
      !forkedFromConversationId ||
      forkMessageCount === undefined ||
      forkMessageCount <= 0
    ) {
      return -1;
    }
    // Count visible (non-tool) messages. forkMessageCount counts all
    // DB messages including tool messages, but tool messages are filtered
    // out during rendering. We iterate the messages array and find the
    // index after the Nth visible message.
    let visibleCount = 0;
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].role === "tool") continue;
      visibleCount++;
      if (visibleCount === forkMessageCount) {
        return i + 1; // divider goes after this message
      }
    }
    // If there are fewer visible messages than forkMessageCount (e.g.
    // tool messages reduced the count), place divider at the end.
    return messages.length;
  }, [forkedFromConversationId, forkMessageCount, messages]);

  const showForkDivider =
    forkDividerIndex >= 0 && forkDividerIndex < messages.length;

  const handleFork = (conversationId: string, upToResponseId: string): void => {
    void handleForkConversation(conversationId, upToResponseId);
  };

  const handleForkLinkClick = (): void => {
    if (forkedFromConversationId) {
      void handleSelectConversation(forkedFromConversationId);
    }
  };

  const renderForkDivider = (): React.JSX.Element => (
    <div className="chat-fork-divider">
      <span className="chat-fork-divider-line" />
      <button
        type="button"
        className="chat-fork-divider-link"
        onClick={handleForkLinkClick}
      >
        <GitFork size={13} strokeWidth={1.8} />
        <span>
          {t("chat.forkedFromConversation", {
            defaultValue: "Forked from conversation",
          })}
        </span>
      </button>
      <span className="chat-fork-divider-line" />
    </div>
  );

  const renderItem = (
    message: ChatConversationMessage
  ): React.JSX.Element | null => {
    if (message.role === "user") {
      if (message.isContextCompaction) {
        return (
          <CompactionMessage
            content={message.content}
            isStreaming={isStreaming}
            onRollback={() => handleRollback(message.id)}
            key={message.id}
          />
        );
      }

      return (
        <UserMessage
          content={message.content}
          isStreaming={isStreaming}
          onRollback={() => handleRollback(message.id)}
          key={message.id}
        />
      );
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
    const hasToolCalls = (message.toolCalls?.length ?? 0) > 0;
    const isMessageStreaming = message.status === "sending";
    // Show actions on:
    // - All assistant messages without tool calls (1-on-1 conversations)
    // - The last assistant message when it has tool calls (AI Loop ending)
    // - Never on a message that is currently streaming
    // - Never while the conversation-level streaming is active (AI Loop in
    //   progress). Without this guard, a message that finishes streaming
    //   but precedes a tool-call round would briefly show actions that
    //   vanish when the next assistant turn starts — causing a flash.
    const showActions =
      !isStreaming && !isMessageStreaming && (!hasToolCalls || isLastAssistant);

    return (
      <div className={className} key={message.id}>
        <AiResponse
          isStreaming={message.status === "sending"}
          isAborting={isLastAssistant && isAborting}
          isRetrying={isLastAssistant && message.isRetrying}
          retryAttempt={message.retryAttempt}
          retryError={message.retryError}
          streamTokenCount={
            isLastAssistant && isStreaming ? streamTokenCount : undefined
          }
          summary={message.content}
          thinking={message.thinking}
          showActions={showActions}
          toolCalls={message.toolCalls}
          pendingToolAuthorizations={
            isLastAssistant
              ? pendingToolAuthorizations.filter(
                  (toolCall) =>
                    toolCall.authorizationConversationId ===
                    activeConversationId
                )
              : undefined
          }
          onApproveToolAuthorization={approveToolAuthorization}
          onApproveToolAuthorizationAlways={approveToolAuthorizationAlways}
          onRejectToolAuthorization={rejectToolAuthorization}
          conversationId={activeConversationId}
          responseId={message.responseId}
          onFork={handleFork}
        />
      </div>
    );
  };

  // If no fork divider needed, render messages directly
  if (!showForkDivider) {
    return (
      <div className="chat-message-list">
        {messages.map(renderItem)}
        {forkDividerIndex === messages.length && forkedFromConversationId
          ? renderForkDivider()
          : null}
      </div>
    );
  }

  // Split messages at the fork divider index
  const beforeFork = messages.slice(0, forkDividerIndex);
  const afterFork = messages.slice(forkDividerIndex);

  return (
    <div className="chat-message-list">
      {beforeFork.map(renderItem)}
      {renderForkDivider()}
      {afterFork.map(renderItem)}
    </div>
  );
};
