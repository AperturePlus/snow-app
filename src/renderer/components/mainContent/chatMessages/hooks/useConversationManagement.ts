import { useCallback } from "react";
import type {
  ConversationContextValue,
  TokenUsage,
} from "../utils/conversationTypes";
import {
  PENDING_SESSION_KEY,
  CHAT_MESSAGE_PAGE_SIZE,
} from "../utils/conversationTypes";
import {
  buildConversationMessages,
  deleteCheckpoints,
} from "../utils/conversationHelpers";

export type UseConversationManagementParams = {
  ctx: ConversationContextValue;
  rejectAllToolAuthorizations: () => void;
  rejectPendingUserQuestions: (sessionKey?: string) => void;
};

/**
 * 会话管理逻辑：选择/新建/中止会话、分页加载历史消息、分叉会话等。
 */
export const useConversationManagement = (
  params: UseConversationManagementParams
) => {
  const { ctx, rejectAllToolAuthorizations, rejectPendingUserQuestions } =
    params;

  const withdrawPendingMessage = useCallback((index: number): string | null => {
    const sessionKey =
      ctx.activeConversationIdRef.current ?? PENDING_SESSION_KEY;
    const queue = ctx.pendingQueueRef.current.get(sessionKey);
    if (!queue || index < 0 || index >= queue.length) {
      return null;
    }

    const [removed] = queue.splice(index, 1);
    if (queue.length === 0) {
      ctx.pendingQueueRef.current.delete(sessionKey);
    }
    ctx.setActivePendingMessages(queue.map((item) => item.text));
    return removed?.text ?? null;
  }, []);

  const handleSelectConversation = useCallback(
    async (
      conversationId: string,
      title?: string,
      conversationTokenUsage?: TokenUsage | null,
      conversationDirId?: string
    ): Promise<void> => {
      const trimmedId = conversationId.trim();
      if (!trimmedId) {
        return;
      }
      const selectionRequestId = ++ctx.selectionRequestIdRef.current;
      const cachedSession = ctx.sessionsRef.current[trimmedId];
      const hasLoadedCachedHistory =
        ctx.sessionsRefData.current.has(trimmedId) &&
        cachedSession?.isInitialHistoryLoaded === true;

      if (
        trimmedId === ctx.activeConversationIdRef.current &&
        hasLoadedCachedHistory
      ) {
        ctx.setIsLoadingInitialHistory(false);
        return;
      }

      ctx.setIsLoadingInitialHistory(true);
      ctx.setActiveId(trimmedId);
      // Selecting an existing conversation cancels any prior "new chat"
      // intent so the UI follows the active conversation normally.
      ctx.setNewChatRequested(false);

      if (hasLoadedCachedHistory) {
        ctx.updateSessionField(trimmedId, "hasNewContent", false);
        ctx.setCompletedConversationIds((prev) => {
          if (!prev.has(trimmedId)) return prev;
          const next = new Set(prev);
          next.delete(trimmedId);
          return next;
        });

        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => resolve());
          });
        });
        if (selectionRequestId === ctx.selectionRequestIdRef.current) {
          ctx.setIsLoadingInitialHistory(false);
        }
        return;
      }

      const nextTitle = title?.trim() ?? "";

      try {
        const [page, conversationRecord] = await Promise.all([
          window.snow.listChatMessagesPaginated(
            trimmedId,
            "",
            CHAT_MESSAGE_PAGE_SIZE
          ),
          window.snow.getChatConversation(trimmedId),
        ]);

        if (selectionRequestId !== ctx.selectionRequestIdRef.current) {
          return;
        }

        const checkpointIds = Array.from(
          new Set(
            page.items
              .filter((record) => record.role === "user" && record.checkpointId)
              .map((record) => record.checkpointId)
          )
        );

        ctx.sessionsRefData.current.set(trimmedId, {
          streamId: null,
          isSending: false,
          isAbortRequested: false,
          runId: 0,
          directoryId: conversationDirId,
          checkpointIds,
          hasAutoCompacted: false,
        });
        ctx.setSessions((prev) => ({
          ...prev,
          [trimmedId]: {
            messages: buildConversationMessages(page.items),
            messageRecords: page.items,
            summary: nextTitle,
            isStreaming: false,
            isAborting: false,
            isPaused: false,
            isLoadingOlderMessages: false,
            hasMoreMessages: page.hasMore,
            isInitialHistoryLoaded: true,
            tokenUsage: conversationTokenUsage ?? null,
            directoryId: conversationDirId,
            hasNewContent: false,
            forkedFromConversationId:
              conversationRecord?.forkedFromConversationId || undefined,
            forkMessageCount: conversationRecord?.forkMessageCount || undefined,
            streamTokenCount: 0,
            streamElapsedMs: 0,
            streamTtftMs: 0,
            streamStartedAt: 0,
          },
        }));
      } catch {
        // 加载历史消息失败时静默处理，不阻断交互
      } finally {
        if (selectionRequestId === ctx.selectionRequestIdRef.current) {
          ctx.setIsLoadingInitialHistory(false);
        }
      }
    },
    [ctx.setActiveId, ctx.updateSessionField, ctx.setNewChatRequested]
  );

  const loadOlderMessages = useCallback(async (): Promise<void> => {
    const conversationId = ctx.activeConversationIdRef.current;
    if (!conversationId) {
      return;
    }

    const session = ctx.sessionsRef.current[conversationId];
    const beforeMessageId = session?.messageRecords[0]?.id;
    if (
      !session ||
      !beforeMessageId ||
      !session.hasMoreMessages ||
      ctx.loadingOlderConversationIdsRef.current.has(conversationId)
    ) {
      return;
    }

    ctx.loadingOlderConversationIdsRef.current.add(conversationId);
    ctx.updateSessionField(conversationId, "isLoadingOlderMessages", true);

    try {
      const page = await window.snow.listChatMessagesPaginated(
        conversationId,
        beforeMessageId,
        CHAT_MESSAGE_PAGE_SIZE
      );
      const currentSession = ctx.sessionsRef.current[conversationId];
      if (!currentSession) {
        return;
      }

      const existingIds = new Set(
        currentSession.messageRecords.map((record) => record.id)
      );
      const olderRecords = page.items.filter(
        (record) => !existingIds.has(record.id)
      );
      const combinedRecords = [
        ...olderRecords,
        ...currentSession.messageRecords,
      ];
      const persistedIds = new Set(
        currentSession.messageRecords.map((record) => record.id)
      );
      const transientMessages = currentSession.messages.filter(
        (message) => !persistedIds.has(message.id)
      );

      ctx.setSessions((prev) => {
        const latestSession = prev[conversationId];
        if (!latestSession) {
          return prev;
        }

        return {
          ...prev,
          [conversationId]: {
            ...latestSession,
            messages: [
              ...buildConversationMessages(combinedRecords),
              ...transientMessages,
            ],
            messageRecords: combinedRecords,
            isLoadingOlderMessages: false,
            hasMoreMessages: page.hasMore,
          },
        };
      });

      const refData = ctx.sessionsRefData.current.get(conversationId);
      if (refData) {
        refData.checkpointIds = Array.from(
          new Set(
            combinedRecords
              .filter((record) => record.role === "user" && record.checkpointId)
              .map((record) => record.checkpointId)
          )
        );
      }
    } catch {
      ctx.updateSessionField(conversationId, "isLoadingOlderMessages", false);
    } finally {
      ctx.loadingOlderConversationIdsRef.current.delete(conversationId);
    }
  }, [ctx.updateSessionField]);

  const handleNewChat = useCallback((): void => {
    ctx.selectionRequestIdRef.current += 1;
    ctx.setIsLoadingInitialHistory(false);

    // Mark that the user explicitly requested a new chat. This prevents the
    // UI from falling back to the pending session (which may still be
    // streaming in the background) and prevents the agent loop from
    // auto-switching back to the migrated conversation once it finishes.
    ctx.setNewChatRequested(true);

    // Clear stale pending session only if it is NOT actively streaming.
    // When the pending session is streaming, we keep it alive so the AI
    // loop continues in the background and eventually persists the
    // conversation. The user sees the empty greeting instead.
    const pendingRef = ctx.sessionsRefData.current.get(PENDING_SESSION_KEY);
    if (pendingRef && !pendingRef.isSending) {
      deleteCheckpoints(pendingRef.checkpointIds);
      ctx.sessionsRefData.current.delete(PENDING_SESSION_KEY);
      ctx.setSessions((prev) => {
        const next = { ...prev };
        delete next[PENDING_SESSION_KEY];
        return next;
      });
    }

    ctx.setActiveId(undefined);
  }, [ctx.setActiveId, ctx.setNewChatRequested]);

  const handleAbort = useCallback((): void => {
    const key = ctx.activeConversationIdRef.current ?? PENDING_SESSION_KEY;
    const ref = ctx.sessionsRefData.current.get(key);
    if (!ref?.isSending || ref.isAbortRequested) {
      return;
    }

    rejectAllToolAuthorizations();
    rejectPendingUserQuestions(key);

    // Wake up the pause checkpoint so the blocked agent loop can observe
    // the cancellation and exit. Without this, a paused loop would hang
    // forever because it is awaiting the pause promise.
    const pauseController = ctx.pauseControllerRef.current.get(key);
    if (pauseController) {
      pauseController.paused = false;
      const resolve = pauseController.resolve;
      pauseController.resolve = null;
      if (resolve) {
        resolve();
      }
    }

    ref.isAbortRequested = true;
    ref.isSending = false;
    ref.runId += 1;
    ctx.updateSessionMessages(key, (currentMessages) =>
      currentMessages.map((message) => {
        return {
          ...message,
          status: message.status === "sending" ? "sent" : message.status,
          isRetrying: message.status === "sending" ? false : message.isRetrying,
          toolCalls: message.toolCalls?.map((toolCall) =>
            toolCall.status === "running" || toolCall.status === "pending"
              ? {
                  ...toolCall,
                  status: "error",
                  result: toolCall.result ?? "Interrupted by user",
                }
              : toolCall
          ),
        };
      })
    );
    ctx.updateSessionField(key, "isStreaming", false);
    ctx.updateSessionField(key, "streamStartedAt", 0);
    ctx.updateSessionField(key, "isAborting", false);
    ctx.updateSessionField(key, "isPaused", false);
    ctx.pauseControllerRef.current.delete(key);
    ctx.removeStreamingId(key);

    if (ref.streamId) {
      void window.snow.abortResponseStream(ref.streamId);
    }
  }, [
    ctx.removeStreamingId,
    rejectAllToolAuthorizations,
    rejectPendingUserQuestions,
    ctx.updateSessionMessages,
    ctx.updateSessionField,
    ctx.pauseControllerRef,
  ]);

  const abortConversation = useCallback(
    (conversationId: string): void => {
      const ref = ctx.sessionsRefData.current.get(conversationId);
      rejectAllToolAuthorizations();
      rejectPendingUserQuestions(conversationId);
      if (ref?.streamId) {
        void window.snow.abortResponseStream(ref.streamId);
        ref.streamId = null;
      }
      if (ref) {
        ref.isSending = false;
      }
      ctx.updateSessionField(conversationId, "isStreaming", false);
      ctx.updateSessionField(conversationId, "streamStartedAt", 0);
      ctx.updateSessionField(conversationId, "isAborting", false);
      ctx.removeStreamingId(conversationId);
      // Clean up session state and incremental checkpoint storage.
      if (ref) {
        deleteCheckpoints(ref.checkpointIds);
      }
      ctx.sessionsRefData.current.delete(conversationId);
      ctx.setSessions((prev) => {
        const next = { ...prev };
        delete next[conversationId];
        return next;
      });
    },
    [
      ctx.removeStreamingId,
      rejectAllToolAuthorizations,
      rejectPendingUserQuestions,
      ctx.updateSessionField,
    ]
  );

  const refreshConversations = useCallback((): void => {
    ctx.setConversationVersion((version) => version + 1);
  }, []);

  const handleForkConversation = useCallback(
    async (conversationId: string, upToResponseId: string): Promise<void> => {
      const trimmedId = conversationId.trim();
      if (!trimmedId) return;

      try {
        const forkedRecord = await window.snow.forkConversation(
          trimmedId,
          upToResponseId.trim()
        );

        // Refresh sidebar list so the new forked conversation appears
        ctx.setUpsertedConversation({
          record: forkedRecord,
          timestamp: Date.now(),
        });

        // Switch to the new forked conversation
        await handleSelectConversation(
          forkedRecord.conversationId,
          forkedRecord.summary || forkedRecord.title,
          {
            inputTokens: forkedRecord.inputTokens,
            outputTokens: forkedRecord.outputTokens,
            cacheCreationInputTokens: forkedRecord.cacheCreationInputTokens,
            cacheReadInputTokens: forkedRecord.cacheReadInputTokens,
          },
          forkedRecord.directoryId
        );
      } catch {
        // Fork failure should not block the UI
      }
    },
    [handleSelectConversation]
  );

  return {
    withdrawPendingMessage,
    handleSelectConversation,
    loadOlderMessages,
    handleNewChat,
    handleAbort,
    abortConversation,
    refreshConversations,
    handleForkConversation,
  };
};
