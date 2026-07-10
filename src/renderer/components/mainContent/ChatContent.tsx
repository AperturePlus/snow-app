import { useCallback, useLayoutEffect, useRef } from "react";
import { LoaderCircle } from "lucide-react";
import type { WorkspaceDirectoryRecord } from "../../../preload";
import { useI18n } from "../../i18n";
import { ChatInput } from "./ChatInput";
import { EmptyGreeting } from "./EmptyGreeting";
import { ChatMessageList, useChatConversationContext } from "./chatMessages";
import { RollbackConfirmDialog } from "./chatMessages/RollbackConfirmDialog";
import type { ChatInputSendOptions } from "./chatInput/types";

type ChatContentProps = {
  activeDirectory?: WorkspaceDirectoryRecord | null;
};

type PendingScrollRestore = {
  conversationId: string;
  scrollHeight: number;
  scrollTop: number;
};

const LOAD_OLDER_SCROLL_THRESHOLD = 96;

export const ChatContent = ({
  activeDirectory,
}: ChatContentProps): React.JSX.Element => {
  const { t } = useI18n();
  const {
    messages,
    activeConversationId,
    isLoadingOlderMessages,
    hasMoreMessages,
    isInitialHistoryLoaded,
    isLoadingInitialHistory,
    loadOlderMessages,
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
  const hasHistoryContent = hasMessages || isLoadingInitialHistory;
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeConversationIdRef = useRef(activeConversationId);
  const positionedConversationIdsRef = useRef(new Set<string>());
  const pendingScrollRestoreRef = useRef<PendingScrollRestore | null>(null);
  const isLoadingOlderWithScrollRef = useRef(false);
  activeConversationIdRef.current = activeConversationId;

  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (
      !container ||
      !activeConversationId ||
      !isInitialHistoryLoaded ||
      messages.length === 0 ||
      positionedConversationIdsRef.current.has(activeConversationId)
    ) {
      return;
    }

    container.scrollTop = container.scrollHeight;
    positionedConversationIdsRef.current.add(activeConversationId);
  }, [activeConversationId, isInitialHistoryLoaded, messages.length]);

  const handleLoadOlderWithScroll = useCallback(async (): Promise<void> => {
    const container = scrollRef.current;
    const conversationId = activeConversationIdRef.current;
    if (!container || !conversationId || isLoadingOlderWithScrollRef.current) {
      return;
    }

    isLoadingOlderWithScrollRef.current = true;
    pendingScrollRestoreRef.current = {
      conversationId,
      scrollHeight: container.scrollHeight,
      scrollTop: container.scrollTop,
    };

    try {
      await loadOlderMessages();
    } finally {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const latestContainer = scrollRef.current;
          const pendingRestore = pendingScrollRestoreRef.current;
          if (
            latestContainer &&
            pendingRestore &&
            pendingRestore.conversationId === activeConversationIdRef.current
          ) {
            const addedHeight =
              latestContainer.scrollHeight - pendingRestore.scrollHeight;
            latestContainer.scrollTop =
              pendingRestore.scrollTop + Math.max(0, addedHeight);
          }

          pendingScrollRestoreRef.current = null;
          isLoadingOlderWithScrollRef.current = false;
        });
      });
    }
  }, [loadOlderMessages]);

  const handleChatScroll = useCallback((): void => {
    const container = scrollRef.current;
    if (
      !container ||
      container.scrollTop > LOAD_OLDER_SCROLL_THRESHOLD ||
      !hasMoreMessages ||
      isLoadingOlderMessages ||
      isLoadingOlderWithScrollRef.current
    ) {
      return;
    }

    void handleLoadOlderWithScroll();
  }, [handleLoadOlderWithScroll, hasMoreMessages, isLoadingOlderMessages]);

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
      className={`chat-content ${
        hasHistoryContent ? "has-messages" : "is-empty"
      }`}
    >
      <div
        className={`chat-area ${
          isLoadingInitialHistory ? "is-loading-history" : ""
        }`}
        ref={scrollRef}
        onScroll={handleChatScroll}
        aria-busy={isLoadingInitialHistory || isLoadingOlderMessages}
      >
        {isLoadingInitialHistory ? (
          <div
            className="chat-initial-history-loader"
            role="status"
            aria-live="polite"
          >
            <LoaderCircle size={20} strokeWidth={1.8} aria-hidden="true" />
            <span>
              {t("chat.loadingConversationMessages", {
                defaultValue: "Loading conversation messages...",
              })}
            </span>
          </div>
        ) : hasMessages ? (
          <>
            {isLoadingOlderMessages ? (
              <div
                className="chat-history-loader"
                role="status"
                aria-live="polite"
              >
                <LoaderCircle size={16} strokeWidth={1.8} aria-hidden="true" />
                <span>
                  {t("chat.loadingOlderMessages", {
                    defaultValue: "Loading older messages...",
                  })}
                </span>
              </div>
            ) : null}
            <ChatMessageList
              messages={messages}
              isStreaming={isStreaming}
              isAborting={isAborting}
            />
          </>
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
