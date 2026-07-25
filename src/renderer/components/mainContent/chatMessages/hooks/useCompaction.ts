import { useCallback } from "react";
import type {
  ConversationContextValue,
  ChatConversationMessage,
} from "../utils/conversationTypes";
import {
  createMessageId,
  deleteCheckpoints,
  formatMessageTime,
} from "../utils/conversationHelpers";

/**
 * 上下文压缩逻辑：手动 /compact 和自动阈值触发的压缩。
 * 压缩流独立于正式消息：contextCompaction=true 时 Rust 使用全量有效上下文
 * 生成交接文档，成功后仅持久化一条 status=context_compaction 的用户消息。
 */
export const useCompaction = (ctx: ConversationContextValue) => {
  const performCompaction = useCallback(
    async (
      conversationId: string,
      model?: string,
      isAuto = false
    ): Promise<string | null> => {
      const sessionRef = ctx.sessionsRefData.current.get(conversationId);
      if (sessionRef) {
        sessionRef.isSending = true;
        sessionRef.isAbortRequested = false;
      }
      ctx.setCompactionPreview("");
      ctx.setCompactionError(null);
      ctx.setIsCompacting(true);

      // Create a file-system checkpoint before compaction so rolling back to
      // the compaction boundary can restore files modified by the subsequent
      // agent loop. A compaction boundary is semantically a user message — its
      // checkpoint captures the working-directory state at the moment the
      // handoff was generated. Skip checkpoint creation for SSH directories
      // where local snapshots are not available.
      let checkpointId: string | undefined;
      if (
        ctx.directoryPath &&
        !ctx.directoryPath.startsWith("ssh://")
      ) {
        try {
          checkpointId = await window.snow.createCheckpoint(
            ctx.directoryPath
          );
          if (sessionRef) {
            sessionRef.checkpointIds = [
              ...sessionRef.checkpointIds,
              checkpointId,
            ];
          }
        } catch {
          // Best effort — continue without a checkpoint. The rollback flow
          // will still truncate the conversation, just without file restore.
        }
      }

      try {
        const response = await window.snow.createResponseStream(
          {
            messages: [{ role: "user", content: "context handoff" }],
            model,
            conversationId,
            directoryId: sessionRef?.directoryId ?? ctx.directoryId,
            contextCompaction: true,
            checkpointId,
          },
          (chunk) => {
            if (chunk.retrying) {
              // Reset accumulated preview so the UI reflects the fresh request
              // the backend is about to re-issue after the stream idle timeout.
              ctx.setCompactionPreview("");
              return;
            }
            ctx.setCompactionPreview(
              (current) => chunk.content || `${current}${chunk.contentDelta}`
            );
          },
          (streamId) => {
            if (sessionRef) {
              sessionRef.streamId = streamId;
            }
          }
        );

        const content = response.content.trim();
        if (!content) {
          throw new Error("Context handoff is empty");
        }

        // Mirror the real token usage from the compaction response into the
        // session so the TokenUsageRing reflects the post-compaction context
        // size. Previously this was reset to null, leaving the UI blind to
        // the actual context state after the handoff.
        if (response.tokenUsage) {
          ctx.updateSessionField(
            conversationId,
            "tokenUsage",
            response.tokenUsage
          );
        }

        const compactionMessage: ChatConversationMessage = {
          id: response.id || createMessageId("user"),
          role: "user",
          content,
          timestamp: formatMessageTime(),
          status: "sent",
          responseId: response.id || undefined,
          model: response.model || model,
          isContextCompaction: true,
          checkpointId,
        };
        ctx.updateSessionMessages(conversationId, (currentMessages) => [
          ...currentMessages,
          compactionMessage,
        ]);
        const latestRecords = await window.snow.listChatMessages(
          conversationId
        );
        ctx.updateSessionField(conversationId, "messageRecords", latestRecords);

        return content;
      } catch (error) {
        if (!isAuto) {
          ctx.setCompactionError(
            error instanceof Error ? error.message : "Failed to compact context"
          );
        }
        // Compaction failed — discard the checkpoint we created at the start of
        // this attempt so it does not linger as an orphan snapshot. Rollback
        // only needs checkpoints for successfully persisted boundaries.
        if (checkpointId) {
          if (sessionRef) {
            sessionRef.checkpointIds = sessionRef.checkpointIds.filter(
              (id) => id !== checkpointId
            );
          }
          deleteCheckpoints([checkpointId]);
        }
        return null;
      } finally {
        if (sessionRef) {
          sessionRef.isSending = false;
          sessionRef.streamId = null;
        }
        ctx.setIsCompacting(false);
        ctx.setCompactionPreview("");

        // For manual compaction, flush pending messages after completion.
        // Auto-compaction runs inside runAgentLoop so the loop itself
        // continues — no pending flush needed.
        if (!isAuto) {
          const pendingQueue =
            ctx.pendingQueueRef.current.get(conversationId) ?? [];
          if (!sessionRef?.isAbortRequested && pendingQueue.length > 0) {
            ctx.pendingQueueRef.current.delete(conversationId);
            const combined = pendingQueue.map((item) => item.text).join("\n\n");
            const lastOptions =
              pendingQueue[pendingQueue.length - 1]?.options ?? {};
            ctx.setActivePendingMessages([]);
            ctx.handleSendMessageRef.current(combined, lastOptions);
          }
        }
      }
    },
    [
      ctx.directoryId,
      ctx.directoryPath,
      ctx.updateSessionField,
      ctx.updateSessionMessages,
      ctx.setCompactionPreview,
      ctx.setCompactionError,
      ctx.setIsCompacting,
      ctx.sessionsRefData,
      ctx.pendingQueueRef,
      ctx.setActivePendingMessages,
      ctx.handleSendMessageRef,
    ]
  );

  // Keep the ref current so runAgentLoop (defined inside handleSendMessage)
  // can call the latest performCompaction without stale closures.
  ctx.performCompactionRef.current = performCompaction;

  const compactConversation = useCallback(
    async (model?: string): Promise<void> => {
      const conversationId = ctx.activeConversationIdRef.current;
      if (
        !conversationId ||
        ctx.sessionsRefData.current.get(conversationId)?.isSending
      ) {
        return;
      }

      await performCompaction(conversationId, model, false);
    },
    [performCompaction, ctx.activeConversationIdRef, ctx.sessionsRefData]
  );

  return {
    performCompaction,
    compactConversation,
  };
};
