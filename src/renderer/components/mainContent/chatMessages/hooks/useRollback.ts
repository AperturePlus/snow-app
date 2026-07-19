import { useCallback } from "react";
import type {
  ConversationContextValue,
  CheckpointFileChange,
  RollbackMode,
  RollbackTodoItem,
} from "../utils/conversationTypes";
import { PENDING_SESSION_KEY } from "../utils/conversationTypes";
import { deleteCheckpoints } from "../utils/conversationHelpers";

/**
 * 回滚逻辑：中止流、预览文件变更、确认/取消回滚。
 * context_compaction 回滚必须调用 truncateConversation，以其自身 responseId
 * 为起点删除边界及后续消息；不得调用 deleteConversation。
 */
export const useRollback = (ctx: ConversationContextValue) => {
  const clearDraftToRestore = useCallback((): void => {
    ctx.setDraftToRestore(null);
  }, [ctx.setDraftToRestore]);

  const handleRollback = useCallback(
    (messageId: string): void => {
      const key = ctx.activeConversationIdRef.current ?? PENDING_SESSION_KEY;

      // Abort any in-flight stream before rolling back.
      const ref = ctx.sessionsRefData.current.get(key);
      if (ref?.streamId) {
        void window.snow.abortResponseStream(ref.streamId);
        ref.streamId = null;
      }
      if (ref) {
        ref.isSending = false;
      }
      ctx.updateSessionField(key, "isStreaming", false);
      ctx.updateSessionField(key, "isAborting", false);
      ctx.removeStreamingId(key);

      const session = ctx.sessionsRef.current[key];
      if (!session) {
        return;
      }

      const messages = session.messages;
      const targetIndex = messages.findIndex((m) => m.id === messageId);
      if (targetIndex === -1) {
        return;
      }

      const targetMessage = messages[targetIndex];
      const messageContent = targetMessage.content;
      const checkpointId = targetMessage.checkpointId;
      const convId = key !== PENDING_SESSION_KEY ? key : undefined;

      // Delete the entire conversation only when this is the true first user
      // message in the complete history. A compaction boundary and the first item
      // in a paginated window must always use range truncation instead.
      const hasUserMessageBefore = messages
        .slice(0, targetIndex)
        .some((m) => m.role === "user");
      const isFirstMessage =
        !targetMessage.isContextCompaction &&
        !session.hasMoreMessages &&
        !hasUserMessageBefore;

      // Normal user messages roll back from their following assistant response.
      // A compaction boundary is persisted as a user message with its own response id,
      // so rolling back that boundary must target the boundary row itself.
      let responseId = targetMessage.isContextCompaction
        ? targetMessage.responseId
        : undefined;
      if (!responseId) {
        for (let i = targetIndex + 1; i < messages.length; i++) {
          if (messages[i].role === "assistant" && messages[i].responseId) {
            responseId = messages[i].responseId;
            break;
          }
        }
      }

      // Compute file changes for the confirmation dialog. This is async but
      // we set the preview state once the diff is ready.
      const computeAndPreview = async (): Promise<void> => {
        let changes: CheckpointFileChange[] = [];
        if (
          checkpointId &&
          ctx.directoryPath &&
          !ctx.directoryPath.startsWith("ssh://")
        ) {
          try {
            changes = await window.snow.listCheckpointChanges(
              checkpointId,
              ctx.directoryPath
            );
          } catch {
            // Best effort — show dialog without changes on error
          }
        }

        // Fetch TODO items that will be deleted alongside the rollback.
        let todoItems: RollbackTodoItem[] = [];
        if (convId && responseId) {
          try {
            const todoJson = await window.snow.listTodosForRollback(
              convId,
              responseId
            );
            const parsed = JSON.parse(todoJson) as unknown;
            if (Array.isArray(parsed)) {
              todoItems = parsed
                .filter(
                  (item): item is Record<string, unknown> =>
                    typeof item === "object" && item !== null
                )
                .map((item) => ({
                  id: typeof item.id === "string" ? item.id : "",
                  content: typeof item.content === "string" ? item.content : "",
                  status:
                    typeof item.status === "string" ? item.status : "pending",
                }))
                .filter((item) => item.id);
            }
          } catch {
            // Best effort — show empty on error
          }
        }

        ctx.setRollbackPreview({
          messageId,
          messageContent,
          changes,
          checkpointId,
          workDir: ctx.directoryPath,
          convId,
          responseId,
          isFirstMessage,
          isContextCompaction: targetMessage.isContextCompaction === true,
          todoItems,
        });
      };

      void computeAndPreview();
    },
    [
      ctx.directoryPath,
      ctx.updateSessionField,
      ctx.removeStreamingId,
      ctx.activeConversationIdRef,
      ctx.sessionsRefData,
      ctx.sessionsRef,
      ctx.setRollbackPreview,
    ]
  );

  const confirmRollback = useCallback(
    (mode: RollbackMode): void => {
      const preview = ctx.rollbackPreview;
      if (!preview) {
        return;
      }

      const key = ctx.activeConversationIdRef.current ?? PENDING_SESSION_KEY;
      const {
        messageId,
        messageContent,
        checkpointId,
        convId,
        responseId,
        isFirstMessage,
        isContextCompaction,
      } = preview;

      ctx.updateSessionMessages(key, (currentMessages) => {
        const targetIndex = currentMessages.findIndex(
          (message) => message.id === messageId
        );
        return targetIndex === -1
          ? currentMessages
          : currentMessages.slice(0, targetIndex);
      });

      if (checkpointId) {
        const sessionRef = ctx.sessionsRefData.current.get(key);
        const checkpointIndex =
          sessionRef?.checkpointIds.indexOf(checkpointId) ?? -1;
        const discardedCheckpointIds =
          sessionRef && checkpointIndex >= 0
            ? sessionRef.checkpointIds.slice(checkpointIndex)
            : [checkpointId];
        if (sessionRef && checkpointIndex >= 0) {
          sessionRef.checkpointIds = sessionRef.checkpointIds.slice(
            0,
            checkpointIndex
          );
        }

        const shouldRestoreFiles =
          mode === "conversation-and-files" &&
          Boolean(ctx.directoryPath) &&
          !ctx.directoryPath?.startsWith("ssh://");
        if (shouldRestoreFiles && ctx.directoryPath) {
          void window.snow
            .restoreCheckpoint(checkpointId, ctx.directoryPath)
            .then(() => {
              deleteCheckpoints(discardedCheckpointIds);
            })
            .catch(() => {
              if (
                sessionRef &&
                checkpointIndex >= 0 &&
                !sessionRef.checkpointIds.includes(checkpointId)
              ) {
                sessionRef.checkpointIds = [
                  ...sessionRef.checkpointIds,
                  ...discardedCheckpointIds,
                ];
              }
            });
        } else {
          deleteCheckpoints(discardedCheckpointIds);
        }
      }

      if (isFirstMessage && !isContextCompaction && convId) {
        void window.snow
          .deleteConversation(convId)
          .then(() => {
            ctx.setConversationVersion((version) => version + 1);
          })
          .catch(() => {
            // Best effort
          });
        ctx.sessionsRefData.current.delete(key);
        ctx.setSessions((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        ctx.setActiveId(undefined);
      } else if (convId && responseId) {
        ctx.updateSessionField(key, "tokenUsage", null);
        void window.snow.truncateConversation(convId, responseId).catch(() => {
          // Best effort — database persistence must not block the UI refresh.
        });
      }

      if (!isContextCompaction) {
        ctx.setDraftToRestore(messageContent);
      }
      ctx.setRollbackPreview(null);
    },
    [
      ctx.rollbackPreview,
      ctx.directoryPath,
      ctx.updateSessionField,
      ctx.updateSessionMessages,
      ctx.setConversationVersion,
      ctx.setActiveId,
      ctx.setDraftToRestore,
      ctx.setRollbackPreview,
      ctx.sessionsRefData,
      ctx.setSessions,
      ctx.activeConversationIdRef,
    ]
  );

  const cancelRollback = useCallback((): void => {
    ctx.setRollbackPreview(null);
  }, [ctx.setRollbackPreview]);

  return {
    clearDraftToRestore,
    handleRollback,
    confirmRollback,
    cancelRollback,
  };
};
