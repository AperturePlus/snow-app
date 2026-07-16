import { useCallback } from "react";
import type {
  ConversationContextValue,
  ConversationSessionState,
  ChatConversationMessage,
} from "../utils/conversationTypes";

/**
 * 会话管理逻辑：创建、迁移、更新会话状态等。
 * 所有回调通过 ctx 访问共享状态，避免重复声明 ref / state。
 */
export const useConversationSession = (ctx: ConversationContextValue) => {
  const setActiveId = useCallback(
    (id: string | undefined): void => {
      ctx.activeConversationIdRef.current = id;
      ctx.setActiveConversationId(id);
    },
    [ctx.activeConversationIdRef, ctx.setActiveConversationId]
  );

  const ensureSession = useCallback(
    (key: string, dirId?: string): void => {
      if (!ctx.sessionsRefData.current.has(key)) {
        ctx.sessionsRefData.current.set(key, {
          streamId: null,
          isSending: false,
          isAbortRequested: false,
          directoryId: dirId,
          checkpointIds: [],
          hasAutoCompacted: false,
        });
      }
      ctx.setSessions((prev) => {
        if (prev[key]) return prev;
        return {
          ...prev,
          [key]: {
            messages: [],
            messageRecords: [],
            summary: "",
            isStreaming: false,
            isAborting: false,
            isLoadingOlderMessages: false,
            hasMoreMessages: false,
            isInitialHistoryLoaded: true,
            tokenUsage: null,
            directoryId: dirId,
            hasNewContent: false,
          },
        };
      });
    },
    [ctx.sessionsRefData, ctx.setSessions]
  );

  const updateSessionMessages = useCallback(
    (
      key: string,
      updater: (
        messages: ChatConversationMessage[]
      ) => ChatConversationMessage[]
    ): void => {
      ctx.setSessions((prev) => {
        const session = prev[key];
        if (!session) return prev;
        return {
          ...prev,
          [key]: { ...session, messages: updater(session.messages) },
        };
      });
    },
    [ctx.setSessions]
  );

  const updateSessionField = useCallback(
    <K extends keyof ConversationSessionState>(
      key: string,
      field: K,
      value: ConversationSessionState[K]
    ): void => {
      ctx.setSessions((prev) => {
        const session = prev[key];
        if (!session) return prev;
        return { ...prev, [key]: { ...session, [field]: value } };
      });
    },
    [ctx.setSessions]
  );

  const migrateSession = useCallback(
    (oldKey: string, newKey: string): void => {
      const oldRef = ctx.sessionsRefData.current.get(oldKey);
      if (oldRef) {
        ctx.sessionsRefData.current.set(newKey, { ...oldRef });
        ctx.sessionsRefData.current.delete(oldKey);
      }

      const pendingQueue = ctx.pendingQueueRef.current.get(oldKey);
      if (pendingQueue?.length) {
        const existingPendingQueue =
          ctx.pendingQueueRef.current.get(newKey) ?? [];
        ctx.pendingQueueRef.current.set(newKey, [
          ...pendingQueue,
          ...existingPendingQueue,
        ]);
        ctx.pendingQueueRef.current.delete(oldKey);
      }

      ctx.setSessions((prev) => {
        const oldSession = prev[oldKey];
        if (!oldSession) return prev;
        const next = { ...prev };
        next[newKey] = oldSession;
        delete next[oldKey];
        return next;
      });
      ctx.setStreamingConversationIds((prev) => {
        if (!prev.has(oldKey)) return prev;
        const next = new Set(prev);
        next.delete(oldKey);
        next.add(newKey);
        return next;
      });
    },
    [
      ctx.sessionsRefData,
      ctx.pendingQueueRef,
      ctx.setSessions,
      ctx.setStreamingConversationIds,
    ]
  );

  const addStreamingId = useCallback(
    (id: string): void => {
      ctx.setStreamingConversationIds((prev) => {
        if (prev.has(id)) return prev;
        const next = new Set(prev);
        next.add(id);
        return next;
      });
    },
    [ctx.setStreamingConversationIds]
  );

  const removeStreamingId = useCallback(
    (id: string): void => {
      ctx.setStreamingConversationIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    },
    [ctx.setStreamingConversationIds]
  );

  return {
    setActiveId,
    ensureSession,
    updateSessionMessages,
    updateSessionField,
    migrateSession,
    addStreamingId,
    removeStreamingId,
  };
};
