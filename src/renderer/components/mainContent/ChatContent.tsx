import { ArrowDown } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { WorkspaceDirectoryRecord } from "../../../preload";
import { useAutoScrollPreference } from "../../hooks/useAutoScrollPreference";
import { useI18n } from "../../i18n";
import { ChatInput } from "./ChatInput";
import { PixelLogo } from "../common/PixelLogo";
import { ChatMessageList, useChatConversationContext } from "./chatMessages";
import { RollbackConfirmDialog } from "./chatMessages/dialogs/RollbackConfirmDialog";
import { CompactionStream } from "./chatMessages/components/CompactionStream";
import type { ChatInputSendOptions } from "./chatInput/types";
import type { RollbackMode } from "./chatMessages/utils/conversationTypes";

type ChatContentProps = {
  activeDirectory?: WorkspaceDirectoryRecord | null;
};

type PendingScrollRestore = {
  conversationId: string;
  requestId: number;
  scrollHeight: number;
  scrollTop: number;
};

const LOAD_OLDER_SCROLL_THRESHOLD = 96;
const SHOW_SCROLL_TO_BOTTOM_THRESHOLD = 160;

const ChatContentBody = ({
  activeDirectory,
}: ChatContentProps): React.JSX.Element => {
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
    compactConversation,
    compactionPreview,
    compactionError,
    isCompacting,
    yoloMode,
    isUpdatingYoloMode,
    setYoloMode,
    refreshYoloMode,
    planMode,
    isUpdatingPlanMode,
    setPlanMode,
    refreshPlanMode,
    pendingToolAuthorizations,
  } = useChatConversationContext();
  const { t } = useI18n();
  const { autoScrollEnabled, setAutoScrollEnabled } = useAutoScrollPreference();
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
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
  const isInitialBottomPositioningRef = useRef(false);
  const isUserScrollIntentRef = useRef(false);
  const previousIsCompactingRef = useRef(isCompacting);
  const scrollRafIdRef = useRef(0);
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
    isInitialBottomPositioningRef.current = false;
    isUserScrollIntentRef.current = false;
    setShowScrollToBottom(false);
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
      isLoadingInitialHistory ||
      messages.length === 0 ||
      positionedConversationIdsRef.current.has(activeConversationId)
    ) {
      return;
    }

    // content-visibility: auto on .chat-message-group causes scrollHeight to
    // be based on contain-intrinsic-size estimates (80px per message) until
    // the browser lazily renders off-screen messages. These immediate passes
    // handle the first paints; the ResizeObserver below keeps following later
    // height changes from Markdown workers, tool views, and image decoding.
    let rafId1 = 0;
    let rafId2 = 0;
    let rafId3 = 0;

    const scrollToBottom = (): void => {
      container.scrollTop = container.scrollHeight;
    };

    isInitialBottomPositioningRef.current = true;
    isUserScrollIntentRef.current = false;
    shouldStickToBottomRef.current = true;
    setShowScrollToBottom(false);
    scrollToBottom();
    rafId1 = requestAnimationFrame(() => {
      scrollToBottom();
      rafId2 = requestAnimationFrame(() => {
        scrollToBottom();
        rafId3 = requestAnimationFrame(scrollToBottom);
      });
    });

    positionedConversationIdsRef.current.add(activeConversationId);

    return (): void => {
      cancelAnimationFrame(rafId1);
      cancelAnimationFrame(rafId2);
      cancelAnimationFrame(rafId3);
    };
  }, [
    activeConversationId,
    isInitialHistoryLoaded,
    isLoadingInitialHistory,
    messages.length,
  ]);

  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (!container || !activeConversationId) {
      return;
    }

    let resizeRafId = 0;
    let lastScrollHeight = container.scrollHeight;
    const observedChildren = new Set<Element>();

    // Keep the viewport pinned to the latest content synchronously, within
    // the same frame and before paint. The ResizeObserver notification step
    // runs before requestAnimationFrame and before paint, so adjusting
    // scrollTop here ensures grown streaming content is never painted at a
    // stale scroll position — which was the source of the jitter when this
    // work was deferred to requestAnimationFrame.
    const keepAtBottomSync = (): void => {
      if (
        scrollRef.current !== container ||
        activeConversationIdRef.current !== activeConversationId
      ) {
        return;
      }

      const nextScrollHeight = container.scrollHeight;
      const didContentHeightChange = nextScrollHeight !== lastScrollHeight;
      lastScrollHeight = nextScrollHeight;

      if (
        !didContentHeightChange ||
        !shouldStickToBottomRef.current ||
        isLoadingOlderWithScrollRef.current ||
        pendingScrollRestoreRef.current !== null
      ) {
        return;
      }

      container.scrollTop = nextScrollHeight;
      if (
        isInitialBottomPositioningRef.current &&
        !isUserScrollIntentRef.current
      ) {
        setShowScrollToBottom(false);
      }
    };

    // Coalesce bulk DOM mutations (child list changes, image loads) into a
    // single check per animation frame. These events can fire in bursts and a
    // one-frame delay is acceptable here, unlike the per-frame streaming
    // growth handled synchronously by the ResizeObserver above.
    const scheduleResizeCheck = (): void => {
      if (resizeRafId === 0) {
        resizeRafId = requestAnimationFrame(() => {
          resizeRafId = 0;
          keepAtBottomSync();
        });
      }
    };

    const resizeObserver = new ResizeObserver(keepAtBottomSync);
    const observeCurrentChildren = (): void => {
      for (const child of observedChildren) {
        if (!container.contains(child)) {
          resizeObserver.unobserve(child);
          observedChildren.delete(child);
        }
      }

      for (const child of Array.from(container.children)) {
        if (!observedChildren.has(child)) {
          observedChildren.add(child);
          resizeObserver.observe(child);
        }
      }
    };

    observeCurrentChildren();

    const mutationObserver = new MutationObserver(() => {
      observeCurrentChildren();
      scheduleResizeCheck();
    });
    mutationObserver.observe(container, { childList: true });
    container.addEventListener("load", scheduleResizeCheck, true);

    return (): void => {
      if (resizeRafId !== 0) {
        cancelAnimationFrame(resizeRafId);
      }
      container.removeEventListener("load", scheduleResizeCheck, true);
      mutationObserver.disconnect();
      resizeObserver.disconnect();
    };
  }, [activeConversationId]);

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

  // Compaction is an explicit operation, so its preview and persisted boundary
  // must remain visible regardless of the user's normal auto-scroll preference.
  useLayoutEffect(() => {
    const wasCompacting = previousIsCompactingRef.current;
    previousIsCompactingRef.current = isCompacting;
    if (wasCompacting === isCompacting) {
      return;
    }

    shouldStickToBottomRef.current = true;
    const scrollToBottom = (): void => {
      const container = scrollRef.current;
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    };

    scrollToBottom();
    requestAnimationFrame(scrollToBottom);
  }, [isCompacting]);

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

  const markUserScrollIntent = useCallback((): void => {
    isUserScrollIntentRef.current = true;
    isInitialBottomPositioningRef.current = false;
  }, []);

  const handleChatPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX >= bounds.right - 16) {
        markUserScrollIntent();
      }
    },
    [markUserScrollIntent]
  );

  const handleChatKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      if (
        event.key === "ArrowUp" ||
        event.key === "ArrowDown" ||
        event.key === "PageUp" ||
        event.key === "PageDown" ||
        event.key === "Home" ||
        event.key === "End" ||
        event.key === " "
      ) {
        markUserScrollIntent();
      }
    },
    [markUserScrollIntent]
  );

  const handleChatScroll = useCallback((): void => {
    // Throttle scroll handling with requestAnimationFrame to avoid
    // excessive layout reads during fast scrolling through many
    // Markdown-rendered messages.
    if (scrollRafIdRef.current !== 0) {
      return;
    }

    scrollRafIdRef.current = requestAnimationFrame(() => {
      scrollRafIdRef.current = 0;
      const container = scrollRef.current;
      if (!container) {
        return;
      }

      const distanceFromBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      const isFollowingInitialContent =
        isInitialBottomPositioningRef.current && !isUserScrollIntentRef.current;

      if (isFollowingInitialContent) {
        shouldStickToBottomRef.current = true;
        setShowScrollToBottom(false);
        return;
      }

      shouldStickToBottomRef.current = distanceFromBottom < 48;
      setShowScrollToBottom(
        hasMessages && distanceFromBottom > SHOW_SCROLL_TO_BOTTOM_THRESHOLD
      );

      if (
        container.scrollTop > LOAD_OLDER_SCROLL_THRESHOLD ||
        !hasMoreMessages ||
        isLoadingOlderMessages ||
        isLoadingOlderWithScrollRef.current
      ) {
        return;
      }

      void handleLoadOlderWithScroll();
    });
  }, [
    handleLoadOlderWithScroll,
    hasMessages,
    hasMoreMessages,
    isLoadingOlderMessages,
  ]);

  const handleScrollToBottom = useCallback((): void => {
    const container = scrollRef.current;
    if (!container) {
      return;
    }

    shouldStickToBottomRef.current = true;
    isInitialBottomPositioningRef.current = false;
    isUserScrollIntentRef.current = false;
    container.scrollTo({
      top: container.scrollHeight,
      behavior: "smooth",
    });
  }, []);

  const handleSendWithScroll = useCallback(
    (message: string, options: ChatInputSendOptions) => {
      handleSendMessage(message, options);
      shouldStickToBottomRef.current = true;
      isInitialBottomPositioningRef.current = false;
      isUserScrollIntentRef.current = false;
      setShowScrollToBottom(false);
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      });
    },
    [handleSendMessage]
  );

  const handleConfirmRollback = useCallback(
    (mode: RollbackMode): void => {
      confirmRollback(mode);
    },
    [confirmRollback]
  );

  // Cancel any pending scroll-throttle animation frame on unmount.
  useEffect(() => {
    return () => {
      if (scrollRafIdRef.current !== 0) {
        cancelAnimationFrame(scrollRafIdRef.current);
        scrollRafIdRef.current = 0;
      }
    };
  }, []);

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
        onWheel={markUserScrollIntent}
        onTouchStart={markUserScrollIntent}
        onPointerDown={handleChatPointerDown}
        onKeyDown={handleChatKeyDown}
        onScroll={handleChatScroll}
        tabIndex={0}
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
            <CompactionStream
              isCompacting={isCompacting}
              compactionPreview={compactionPreview}
              compactionError={compactionError}
            />
          </>
        ) : (
          <div className="chat-empty-greeting">
            <div className="chat-empty-greeting-brand">
              <PixelLogo className="chat-empty-greeting-logo" />
            </div>
            <p className="chat-empty-greeting-title">
              {activeDirectory
                ? t("chat.greetingWithProject", {
                    defaultValue: "What would you like to work on in {{name}}?",
                    values: { name: activeDirectory.name },
                  })
                : t("chat.greetingNoProject", {
                    defaultValue: "Select a workspace project to get started.",
                  })}
            </p>
          </div>
        )}
      </div>

      <div className="chat-input-region">
        {showScrollToBottom && hasMessages ? (
          <button
            className="chat-scroll-to-bottom"
            type="button"
            onClick={handleScrollToBottom}
            aria-label={t("chat.scrollToBottom")}
            title={t("chat.scrollToBottom")}
          >
            <ArrowDown size={20} strokeWidth={2} aria-hidden="true" />
          </button>
        ) : null}
        <ChatInput
          projectId={activeDirectory?.directoryId}
          projectName={activeDirectory?.name}
          conversationId={activeConversationId}
          onSend={handleSendWithScroll}
          isStreaming={isStreaming}
          isAborting={isAborting}
          onAbort={handleAbort}
          tokenUsage={tokenUsage}
          draftToRestore={draftToRestore}
          onDraftRestored={clearDraftToRestore}
          pendingMessages={pendingMessages}
          onWithdrawPendingMessage={withdrawPendingMessage}
          onCompactConversation={compactConversation}
          yoloMode={yoloMode}
          isUpdatingYoloMode={isUpdatingYoloMode}
          onYoloModeChange={setYoloMode}
          onRefreshYoloMode={refreshYoloMode}
          planMode={planMode}
          isUpdatingPlanMode={isUpdatingPlanMode}
          onPlanModeChange={setPlanMode}
          onRefreshPlanMode={refreshPlanMode}
          autoScrollEnabled={autoScrollEnabled}
          onAutoScrollChange={setAutoScrollEnabled}
          isCompacting={isCompacting}
        />
      </div>

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
  return <ChatContentBody activeDirectory={activeDirectory} />;
};
