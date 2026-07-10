import { useCallback, useRef } from "react";
import type { WorkspaceDirectoryRecord } from "../../../preload";
import { ChatInput } from "./ChatInput";
import { EmptyGreeting } from "./EmptyGreeting";
import { ChatMessageList, useChatConversationContext } from "./chatMessages";
import { RollbackConfirmDialog } from "./chatMessages/RollbackConfirmDialog";
import type { ChatInputSendOptions } from "./chatInput/types";

type ChatContentProps = {
  activeDirectory?: WorkspaceDirectoryRecord | null;
};

export const ChatContent = ({
  activeDirectory,
}: ChatContentProps): React.JSX.Element => {
  const {
    messages,
    handleSendMessage,
    isStreaming,
    isAborting,
    handleAbort,
    tokenUsage,
    draftToRestore,
    clearDraftToRestore,
    rollbackPreview,
    confirmRollback,
    cancelRollback,
  } = useChatConversationContext();
  const hasMessages = messages.length > 0;
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleSendWithScroll = useCallback(
    (message: string, options: ChatInputSendOptions) => {
      handleSendMessage(message, options);
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      });
    },
    [handleSendMessage]
  );

  return (
    <div
      className={`chat-content ${hasMessages ? "has-messages" : "is-empty"}`}
    >
      <div className="chat-area" ref={scrollRef}>
        {hasMessages ? (
          <ChatMessageList
            messages={messages}
            isStreaming={isStreaming}
            isAborting={isAborting}
          />
        ) : (
          <EmptyGreeting activeDirectory={activeDirectory} />
        )}
      </div>

      <ChatInput
        onSend={handleSendWithScroll}
        isStreaming={isStreaming}
        onAbort={handleAbort}
        tokenUsage={tokenUsage}
        draftToRestore={draftToRestore}
        onDraftRestored={clearDraftToRestore}
      />

      {rollbackPreview ? (
        <RollbackConfirmDialog
          changes={rollbackPreview.changes}
          checkpointId={rollbackPreview.checkpointId}
          workDir={rollbackPreview.workDir}
          isFirstMessage={rollbackPreview.isFirstMessage}
          onConfirm={confirmRollback}
          onCancel={cancelRollback}
        />
      ) : null}
    </div>
  );
};
