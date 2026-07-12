import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { WorkspaceDirectoryRecord } from "../../../preload";
import { useAutoScrollPreference } from "../../hooks/useAutoScrollPreference";
import { ChatInput } from "./ChatInput";
import { EmptyGreeting } from "./EmptyGreeting";
import { ChatMessageList, useChatConversationContext } from "./chatMessages";
import { RollbackConfirmDialog } from "./chatMessages/RollbackConfirmDialog";
import type { ChatInputSendOptions } from "./chatInput/types";

type ChatContentProps = {
  activeDirectory?: WorkspaceDirectoryRecord | null;
};

type ChatContentBodyProps = ChatContentProps & {
  onRollbackConfirmed: () => void;
};

type PendingScrollRestore = {
  conversationId: string;
  requestId: number;
  scrollHeight: number;
  scrollTop: number;
};

const LOAD_OLDER_SCROLL_THRESHOLD = 96;

const ChatContentBody = ({
  activeDirectory,
  onRollbackConfirmed,
}: ChatContentBodyProps): React.JSX.Element => {
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
    pendingMessages,
    withdrawPendingMessage,
    yoloMode,
    isUpdatingYoloMode,
    setYoloMode,
    refreshYoloMode,
    pendingToolAuthorizations,
  } = useChatConversationContext();
  const { autoScrollEnabled, setAutoScrollEnabled } = useAutoScrollPreference();
  const hasMessages = messages.length > 0;
  const hasHistoryContent = hasMessages || isLoadingInitialHistory;
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeConversationIdRef = useRef(activeConversationId);
  const previousActiveConversationIdRef = useRef(activeConversationId);
  const positionedConversationIdsRef = useRef(new Set<string>());
  const pendingScrollRestoreRef = useRef<PendingScrollRestore | null>(null);
  const scrollRestoreRequestIdRef = useRef(0);
  const isLoadingOlderWithScrollRef = useRef(false);
  const scrolledAuthorizationSignatureRef = useRef("");
  const shouldStickToBottomRef = useRef(true);
  activeConversationIdRef.current = activeConversationId;

  useLayoutEffect(() => {
    if (previousActiveConversationIdRef.current === activeConversationId) {
      return;
    }

    previousActiveConversationIdRef.current = activeConversationId;
    scrollRestoreRequestIdRef.current += 1;
    pendingScrollRestoreRef.current = null;
    isLoadingOlderWithScrollRef.current = false;
    scrolledAuthorizationSignatureRef.current = "";
    shouldStickToBottomRef.current = true;
    if (activeConversationId) {
      positionedConversationIdsRef.current.delete(activeConversationId);
    }

    const container = scrollRef.current;
    if (container) {
      container.scrollTop = 0;
    }
  }, [activeConversationId]);

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

  // When tool authorization prompts appear, force-scroll the chat area to
  // the bottom so users do not miss the confirmation while reading earlier
  // messages and leave the agent loop blocked without noticing.
  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (!container || !activeConversationId) {
      return;
    }

    const visibleAuthorizations = pendingToolAuthorizations.filter(
      (toolCall) =>
        toolCall.authorizationConversationId === activeConversationId
    );
    if (visibleAuthorizations.length === 0) {
      scrolledAuthorizationSignatureRef.current = "";
      return;
    }

    const signature = visibleAuthorizations
      .map(
        (toolCall) =>
          toolCall.authorizationId ??
          `${toolCall.name}-${toolCall.callId ?? toolCall.arguments}`
      )
      .join("|");
    if (signature === scrolledAuthorizationSignatureRef.current) {
      return;
    }

    scrolledAuthorizationSignatureRef.current = signature;
    requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    });
  }, [activeConversationId, pendingToolAuthorizations]);

  // Keep the chat pinned to the latest AI output while streaming, unless the
  // user scrolls away or has disabled the preference entirely.
  useLayoutEffect(() => {
    if (
      !autoScrollEnabled ||
      !isStreaming ||
      !shouldStickToBottomRef.current ||
      !scrollRef.current
    ) {
      return;
    }

    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [autoScrollEnabled, isStreaming, messages]);

  const handleLoadOlderWithScroll = useCallback(async (): Promise<void> => {
    const container = scrollRef.current;
    const conversationId = activeConversationIdRef.current;
    if (!container || !conversationId || isLoadingOlderWithScrollRef.current) {
      return;
    }

    const requestId = ++scrollRestoreRequestIdRef.current;
    isLoadingOlderWithScrollRef.current = true;
    pendingScrollRestoreRef.current = {
      conversationId,
      requestId,
      scrollHeight: container.scrollHeight,
      scrollTop: container.scrollTop,
    };

    try {
      await loadOlderMessages();
    } finally {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const pendingRestore = pendingScrollRestoreRef.current;
          if (
            pendingRestore &&
            pendingRestore.requestId === requestId &&
            pendingRestore.conversationId === activeConversationIdRef.current &&
            scrollRef.current === container
          ) {
            const addedHeight =
              container.scrollHeight - pendingRestore.scrollHeight;
            container.scrollTop =
              pendingRestore.scrollTop + Math.max(0, addedHeight);
          }

          if (scrollRestoreRequestIdRef.current === requestId) {
            pendingScrollRestoreRef.current = null;
            isLoadingOlderWithScrollRef.current = false;
          }
        });
      });
    }
  }, [loadOlderMessages]);

  const handleChatScroll = useCallback((): void => {
    const container = scrollRef.current;
    if (!container) {
      return;
    }

    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    shouldStickToBottomRef.current = distanceFromBottom < 48;

    if (
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
      shouldStickToBottomRef.current = true;
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      });
    },
    [handleSendMessage]
  );

  const handleConfirmRollback = useCallback((): void => {
    confirmRollback();
    onRollbackConfirmed();
  }, [confirmRollback, onRollbackConfirmed]);

  return (
    <div
      className={`chat-content ${
        hasHistoryContent ? "has-messages" : "is-empty"
      }`}
    >
      <div
        key={activeConversationId ?? "new-chat"}
        className={`chat-area ${
          isLoadingInitialHistory ? "is-loading-history" : ""
        }`}
        ref={scrollRef}
        onScroll={handleChatScroll}
        aria-busy={isLoadingInitialHistory || isLoadingOlderMessages}
      >
        {isLoadingInitialHistory ? (
          <div className="chat-initial-history-skeleton" aria-hidden="true">
            {Array.from({ length: 3 }, (_, index) => (
              <div
                className={`chat-message-skeleton ${
                  index === 1 ? "is-user" : "is-assistant"
                }`}
                key={index}
              >
                <div className="chat-message-skeleton-line is-primary" />
                <div className="chat-message-skeleton-line is-secondary" />
                {index === 0 ? (
                  <div className="chat-message-skeleton-line is-tertiary" />
                ) : null}
              </div>
            ))}
          </div>
        ) : hasMessages ? (
          <>
            {isLoadingOlderMessages ? (
              <div className="chat-history-skeleton" aria-hidden="true">
                <div className="chat-history-skeleton-line" />
                <div className="chat-history-skeleton-line" />
                <div className="chat-history-skeleton-line" />
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
        isAborting={isAborting}
        onAbort={handleAbort}
        tokenUsage={tokenUsage}
        draftToRestore={draftToRestore}
        onDraftRestored={clearDraftToRestore}
        pendingMessages={pendingMessages}
        onWithdrawPendingMessage={withdrawPendingMessage}
        yoloMode={yoloMode}
        isUpdatingYoloMode={isUpdatingYoloMode}
        onYoloModeChange={setYoloMode}
        onRefreshYoloMode={refreshYoloMode}
        autoScrollEnabled={autoScrollEnabled}
        onAutoScrollChange={setAutoScrollEnabled}
      />

      {rollbackPreview ? (
        <RollbackConfirmDialog
          changes={rollbackPreview.changes}
          checkpointId={rollbackPreview.checkpointId}
          workDir={rollbackPreview.workDir}
          isFirstMessage={rollbackPreview.isFirstMessage}
          todoItems={rollbackPreview.todoItems}
          onConfirm={handleConfirmRollback}
          onCancel={cancelRollback}
        />
      ) : null}
    </div>
  );
};

export const ChatContent = ({
  activeDirectory,
}: ChatContentProps): React.JSX.Element => {
  const [renderVersion, setRenderVersion] = useState(0);

  const handleRollbackConfirmed = useCallback((): void => {
    setRenderVersion((currentVersion) => currentVersion + 1);
  }, []);

  return (
    <ChatContentBody
      key={renderVersion}
      activeDirectory={activeDirectory}
      onRollbackConfirmed={handleRollbackConfirmed}
    />
  );
};
