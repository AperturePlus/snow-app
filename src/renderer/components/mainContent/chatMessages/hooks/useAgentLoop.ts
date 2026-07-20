import { useCallback, useRef } from "react";
import type { ChatInputSendOptions } from "../../chatInput/types";
import type {
  ChatConversationMessage,
  ConversationContextValue,
  ToolAuthorizationDecision,
  ToolCallInfo,
} from "../utils/conversationTypes";
import { PENDING_SESSION_KEY } from "../utils/conversationTypes";
import {
  createMessageId,
  formatMessageTime,
  formatMcpToolResultForModel,
  getErrorMessage,
  isUserQuestionCancellationResult,
  parseToolCalls,
  updateFirstMatchingToolCall,
  validateToolCall,
} from "../utils/conversationHelpers";
import { evaluatePlanGate, isPlanApprovalResult } from "../utils/planModeGate";
import { calculateAutoCompressThresholdTokens } from "../../../sidebar/apiSettings/autoCompressThreshold";

export type UseAgentLoopParams = {
  ctx: ConversationContextValue;
  requestToolAuthorizations: (
    toolCalls: ToolCallInfo[],
    conversationId: string,
    projectId?: string
  ) => Promise<ToolAuthorizationDecision[]>;
  rejectAllToolAuthorizations: () => void;
  rejectPendingUserQuestions: (sessionKey?: string) => void;
};

/**
 * Agent 循环逻辑：处理用户消息发送、子代理激活、主 agent 循环和检查点初始化。
 * 这些函数深度嵌套，共享闭包变量，必须放在同一个文件中。
 */
export const useAgentLoop = (params: UseAgentLoopParams) => {
  const { ctx, requestToolAuthorizations } = params;

  // Plan Mode approval state: per-session flag indicating the user has
  // explicitly approved the plan via askUserQuestion. Reset whenever planMode
  // is toggled or a new conversation starts.
  const planApprovedRef = useRef(false);

  const handleSendMessage = useCallback(
    (message: string, options: ChatInputSendOptions) => {
      const trimmed = message.trim();
      if (!trimmed) {
        return;
      }

      const sessionKey =
        ctx.activeConversationIdRef.current ?? PENDING_SESSION_KEY;
      const existingRef = ctx.sessionsRefData.current.get(sessionKey);
      if (existingRef?.isSending) {
        const queue = ctx.pendingQueueRef.current.get(sessionKey) ?? [];
        queue.push({ text: trimmed, options });
        ctx.pendingQueueRef.current.set(sessionKey, queue);
        ctx.setActivePendingMessages(queue.map((item) => item.text));
        return;
      }

      const isFirstMessage = ctx.activeConversationIdRef.current === undefined;
      const sessionDirId = existingRef?.directoryId ?? ctx.directoryId;

      // Reset Plan Mode approval state for each new user message. The user
      // must re-approve the plan for every new task.
      planApprovedRef.current = false;

      ctx.ensureSession(sessionKey, sessionDirId);
      const sessionRef = ctx.sessionsRefData.current.get(sessionKey);
      if (sessionRef) {
        sessionRef.isSending = true;
        sessionRef.isAbortRequested = false;
      }

      const userMessage: ChatConversationMessage = {
        id: createMessageId("user"),
        role: "user",
        content: trimmed,
        timestamp: formatMessageTime(),
        status: "sent",
      };
      const assistantMessageId = createMessageId("assistant");
      const pendingAssistantMessage: ChatConversationMessage = {
        id: assistantMessageId,
        role: "assistant",
        content: "",
        timestamp: formatMessageTime(),
        status: "sending",
        model: options.model,
      };

      ctx.updateSessionField(sessionKey, "isStreaming", true);
      ctx.addStreamingId(sessionKey);
      ctx.updateSessionMessages(sessionKey, (currentMessages) => [
        ...currentMessages,
        userMessage,
        pendingAssistantMessage,
      ]);

      // First message: immediately show a placeholder in the sidebar list
      // so the user sees the new conversation without waiting for AI response.
      if (isFirstMessage) {
        const nowIso = new Date().toISOString();
        const preview =
          trimmed.length > 50 ? `${trimmed.slice(0, 50)}...` : trimmed;
        ctx.setUpsertedConversation({
          record: {
            conversationId: PENDING_SESSION_KEY,
            title: trimmed,
            summary: "",
            lastMessagePreview: preview,
            messageCount: 1,
            model: options.model ?? "",
            status: "active",
            directoryId: sessionDirId ?? "",
            forkedFromConversationId: "",
            forkMessageCount: 0,
            conversationType: "main",
            parentConversationId: "",
            subAgentId: "",
            subAgentName: "",
            subAgentStatus: "",
            subAgentError: "",
            createdAt: nowIso,
            updatedAt: nowIso,
            inputTokens: 0,
            outputTokens: 0,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
          },
          timestamp: Date.now(),
        });
      }

      let finalSessionKey = sessionKey;

      const executeSubAgentActivation = async (
        argsJson: string,
        parentConversationId: string,
        dirId: string
      ): Promise<string> => {
        // Inherit checkpoint ids from the parent session so that file changes
        // made by sub-agent tools are recorded into the same checkpoint
        // manifest.  This allows the main conversation rollback to detect and
        // restore sub-agent modifications alongside the parent's own changes.
        const parentCheckpointIds =
          ctx.sessionsRefData.current.get(parentConversationId)
            ?.checkpointIds ?? [];
        const subCheckpointWorkDir =
          parentCheckpointIds.length > 0 ? ctx.directoryPath : undefined;

        const parsedArgs = JSON.parse(argsJson) as Record<string, unknown>;
        const agentId =
          typeof parsedArgs.agentId === "string" ? parsedArgs.agentId : "";
        const prompt =
          typeof parsedArgs.prompt === "string" ? parsedArgs.prompt : "";

        if (!agentId || !prompt) {
          return JSON.stringify({
            success: false,
            error: "agentId and prompt are required",
          });
        }
        let subConversationId: string | undefined;
        let subAgentName: string | undefined;
        let config: Awaited<ReturnType<typeof window.snow.getSubAgentConfig>> =
          null;

        try {
          config = await window.snow.getSubAgentConfig(agentId);
          if (!config) {
            return JSON.stringify({
              success: false,
              error: `Sub-agent configuration not found: ${agentId}`,
            });
          }

          subConversationId = `sub-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 10)}`;
          const title =
            prompt.length > 80 ? `${prompt.slice(0, 80)}...` : prompt;

          await window.snow.createSubAgentSession(
            subConversationId,
            parentConversationId,
            agentId,
            config.name,
            dirId,
            options.model ?? "",
            title
          );

          await window.snow.updateSubAgentSessionStatus(
            subConversationId,
            "running",
            ""
          );

          ctx.setSubAgentSessionEvent({
            parentConversationId,
            conversationId: subConversationId,
            agentId,
            agentName: config.name,
            status: "running",
            timestamp: Date.now(),
          });

          const allowedTools = JSON.parse(config.toolsJson) as string[];
          const subAgentToolsJson = config.toolsJson;
          const subAgentConfigProfile = config.configProfile.trim();
          subAgentName = config.name;

          const subConvId = subConversationId!;
          ctx.ensureSession(subConvId, dirId);
          const subSessionRef = ctx.sessionsRefData.current.get(subConvId);
          if (subSessionRef) {
            subSessionRef.isSending = true;
            subSessionRef.isAbortRequested = false;
          }
          ctx.updateSessionField(subConvId, "isStreaming", true);
          ctx.addStreamingId(subConvId);

          const subUserMessage: ChatConversationMessage = {
            id: createMessageId("user"),
            role: "user",
            content: prompt,
            timestamp: formatMessageTime(),
            status: "sent",
          };

          ctx.updateSessionMessages(subConvId, (currentMessages) => [
            ...currentMessages,
            subUserMessage,
          ]);

          const subAgentRunLoop = async (
            subMessages: {
              role: "user" | "assistant" | "system" | "developer" | "tool";
              content: string;
            }[]
          ): Promise<string> => {
            if (ctx.sessionsRefData.current.get(subConvId)?.isAbortRequested) {
              return "Sub-agent interrupted by user";
            }

            const subAssistantMessageId = createMessageId("assistant");
            const subAssistantMessage: ChatConversationMessage = {
              id: subAssistantMessageId,
              role: "assistant",
              content: "",
              timestamp: formatMessageTime(),
              status: "sending",
            };

            ctx.updateSessionMessages(subConvId, (currentMessages) => [
              ...currentMessages,
              subAssistantMessage,
            ]);

            const subResponse = await window.snow.createResponseStream(
              {
                messages: subMessages,
                conversationId: subConvId,
                directoryId: dirId,
                subAgentToolsJson,
                subAgentConfigProfile: subAgentConfigProfile || undefined,
              },
              (chunk) => {
                if (
                  ctx.sessionsRefData.current.get(subConvId)?.isAbortRequested
                ) {
                  return;
                }

                // Mirror the real-time token probe into the sub-agent
                // session state so its UI stays in sync.
                ctx.updateSessionField(
                  subConvId,
                  "streamTokenCount",
                  chunk.streamTokenCount
                );

                ctx.updateSessionMessages(subConvId, (currentMessages) =>
                  currentMessages.map((currentMessage) => {
                    if (currentMessage.id !== subAssistantMessageId) {
                      return currentMessage;
                    }

                    if (chunk.retrying) {
                      return {
                        ...currentMessage,
                        isRetrying: true,
                        retryAttempt: chunk.retryAttempt ?? undefined,
                        retryError: chunk.retryError ?? undefined,
                        status: "sending",
                      };
                    }

                    const existingContent = currentMessage.content;
                    const nextContent =
                      chunk.content ||
                      `${existingContent}${chunk.contentDelta}`;
                    const nextThinking =
                      chunk.thinking ||
                      `${currentMessage.thinking ?? ""}${chunk.thinkingDelta}`;

                    return {
                      ...currentMessage,
                      content: nextContent,
                      thinking: nextThinking || undefined,
                      timestamp: formatMessageTime(),
                      status: "sending",
                      isRetrying: false,
                    };
                  })
                );
              },
              (streamId: string) => {
                const ref = ctx.sessionsRefData.current.get(subConvId);
                if (ref) {
                  ref.streamId = streamId;
                  if (ref.isAbortRequested) {
                    void window.snow.abortResponseStream(streamId);
                  }
                }
              }
            );

            const subRef = ctx.sessionsRefData.current.get(subConvId);
            if (subRef) {
              subRef.streamId = null;
            }

            if (ctx.sessionsRefData.current.get(subConvId)?.isAbortRequested) {
              ctx.updateSessionMessages(subConvId, (currentMessages) =>
                currentMessages.map((currentMessage) =>
                  currentMessage.id === subAssistantMessageId
                    ? {
                        ...currentMessage,
                        status: "sent" as const,
                        content:
                          currentMessage.content ||
                          "Sub-agent interrupted by user",
                        isRetrying: false,
                      }
                    : currentMessage
                )
              );
              return "Sub-agent interrupted by user";
            }

            if (subResponse.tokenUsage && subResponse.status !== "error") {
              ctx.updateSessionField(
                subConvId,
                "tokenUsage",
                subResponse.tokenUsage
              );
            }

            const subToolCalls = parseToolCalls(subResponse.toolCallsJson);

            if (subToolCalls.length === 0) {
              ctx.updateSessionMessages(subConvId, (currentMessages) =>
                currentMessages.map((currentMessage) =>
                  currentMessage.id === subAssistantMessageId
                    ? {
                        ...currentMessage,
                        content:
                          subResponse.content ||
                          currentMessage.content ||
                          (subResponse.status === "incomplete"
                            ? "Sub-agent response was interrupted. Please retry."
                            : "Sub-agent completed with no output."),
                        status: "sent" as const,
                        responseId: subResponse.id || undefined,
                        model: subResponse.model || undefined,
                        isRetrying: false,
                      }
                    : currentMessage
                )
              );

              return (
                subResponse.content ||
                (subResponse.status === "incomplete"
                  ? "Sub-agent response was interrupted. Please retry."
                  : "Sub-agent completed with no output.")
              );
            }

            ctx.updateSessionMessages(subConvId, (currentMessages) =>
              currentMessages.map((currentMessage) =>
                currentMessage.id === subAssistantMessageId
                  ? {
                      ...currentMessage,
                      content: subResponse.content || "",
                      thinking: subResponse.thinking || undefined,
                      toolCalls: subToolCalls.map((tc) => ({
                        ...tc,
                        status: "pending" as const,
                      })),
                      status: "sent" as const,
                      responseId: subResponse.id || undefined,
                      model: subResponse.model || undefined,
                      isRetrying: false,
                    }
                  : currentMessage
              )
            );

            const subAuthorizationDecisions = await requestToolAuthorizations(
              subToolCalls,
              subConvId,
              dirId
            );

            const subToolResults: string[] = [];
            for (
              let subToolIndex = 0;
              subToolIndex < subToolCalls.length;
              subToolIndex++
            ) {
              const subToolCall = subToolCalls[subToolIndex];
              const subAuthorizationDecision =
                subAuthorizationDecisions[subToolIndex];

              if (
                ctx.sessionsRefData.current.get(subConvId)?.isAbortRequested
              ) {
                return "Sub-agent interrupted by user";
              }

              if (subAuthorizationDecision.status === "rejected") {
                const subRejectResult = JSON.stringify({
                  success: false,
                  error: "TOOL_EXECUTION_DENIED_BY_USER",
                  reason:
                    subAuthorizationDecision.reason ||
                    "User declined tool execution",
                });
                subToolResults.push(
                  `[Tool: ${subToolCall.name}]\n${formatMcpToolResultForModel(
                    subRejectResult
                  )}`
                );

                ctx.updateSessionMessages(subConvId, (currentMessages) =>
                  currentMessages.map((currentMessage) => {
                    if (currentMessage.id !== subAssistantMessageId) {
                      return currentMessage;
                    }
                    return {
                      ...currentMessage,
                      toolCalls: updateFirstMatchingToolCall(
                        currentMessage.toolCalls,
                        subToolCall,
                        ["pending"],
                        (currentToolCall) => ({
                          ...currentToolCall,
                          status: "completed" as const,
                          result: subRejectResult,
                        })
                      ),
                    };
                  })
                );
                continue;
              }

              let subSensitiveAuthorizationToken: string | undefined;
              if (
                subToolCall.name === "mcp__bash__terminal-execute" &&
                subAuthorizationDecision.status === "approved" &&
                subAuthorizationDecision.sensitiveCommandConfirmed === true
              ) {
                try {
                  const subParsedArgs = JSON.parse(
                    subToolCall.arguments || "{}"
                  ) as Record<string, unknown>;
                  if (typeof subParsedArgs.command !== "string") {
                    throw new Error("Sensitive command argument is missing");
                  }
                  subSensitiveAuthorizationToken =
                    await window.snow.issueSensitiveCommandAuthorization(
                      subParsedArgs.command
                    );
                } catch {
                  // If authorization fails, let the tool fail naturally.
                }
              }

              ctx.updateSessionMessages(subConvId, (currentMessages) =>
                currentMessages.map((currentMessage) => {
                  if (currentMessage.id !== subAssistantMessageId) {
                    return currentMessage;
                  }
                  return {
                    ...currentMessage,
                    toolCalls: updateFirstMatchingToolCall(
                      currentMessage.toolCalls,
                      subToolCall,
                      ["pending"],
                      (currentToolCall) => ({
                        ...currentToolCall,
                        status: "running" as const,
                      })
                    ),
                  };
                })
              );

              let subResult: string;
              try {
                subResult = await window.snow.callMcpTool(
                  subToolCall.name,
                  subToolCall.arguments,
                  dirId,
                  parentCheckpointIds,
                  subCheckpointWorkDir,
                  subSensitiveAuthorizationToken,
                  (chunk) => {
                    if (!chunk.data) {
                      return;
                    }
                    ctx.updateSessionMessages(subConvId, (currentMessages) =>
                      currentMessages.map((currentMessage) => {
                        if (currentMessage.id !== subAssistantMessageId) {
                          return currentMessage;
                        }
                        return {
                          ...currentMessage,
                          toolCalls: updateFirstMatchingToolCall(
                            currentMessage.toolCalls,
                            subToolCall,
                            ["pending", "running"],
                            (currentToolCall) => ({
                              ...currentToolCall,
                              streamingStdout:
                                chunk.stream === "stdout"
                                  ? `${currentToolCall.streamingStdout ?? ""}${
                                      chunk.data
                                    }`
                                  : currentToolCall.streamingStdout,
                              streamingStderr:
                                chunk.stream === "stderr"
                                  ? `${currentToolCall.streamingStderr ?? ""}${
                                      chunk.data
                                    }`
                                  : currentToolCall.streamingStderr,
                            })
                          ),
                        };
                      })
                    );
                  },
                  subToolCall.interactionId,
                  allowedTools
                );
              } catch (err) {
                subResult = JSON.stringify({ error: getErrorMessage(err) });
              }

              ctx.updateSessionMessages(subConvId, (currentMessages) =>
                currentMessages.map((currentMessage) => {
                  if (currentMessage.id !== subAssistantMessageId) {
                    return currentMessage;
                  }
                  return {
                    ...currentMessage,
                    toolCalls: updateFirstMatchingToolCall(
                      currentMessage.toolCalls,
                      subToolCall,
                      ["pending", "running"],
                      (currentToolCall) => ({
                        ...currentToolCall,
                        status: "completed" as const,
                        result: subResult,
                      })
                    ),
                  };
                })
              );

              const subIdentifier = subToolCall.callId
                ? `${subToolCall.name}#${subToolCall.callId}`
                : subToolCall.name;
              subToolResults.push(
                `[Tool: ${subIdentifier}]\n${formatMcpToolResultForModel(
                  subResult
                )}`
              );
            }

            const subToolResultMessage: ChatConversationMessage = {
              id: createMessageId("tool"),
              role: "tool",
              content: subToolResults.join("\n\n"),
              timestamp: formatMessageTime(),
              status: "sent",
              toolName: subToolCalls.map((tc) => tc.name).join(", "),
            };

            ctx.updateSessionMessages(subConvId, (currentMessages) => [
              ...currentMessages,
              subToolResultMessage,
            ]);

            // Flush pending user messages before the next AI request so
            // they are sent in the next iteration as soon as tools finish.
            const subPendingForTools =
              ctx.pendingQueueRef.current.get(subConvId) ?? [];
            const subNextMessages: {
              role: "user" | "assistant" | "system" | "developer" | "tool";
              content: string;
            }[] = [{ role: "tool", content: subToolResults.join("\n\n") }];
            if (subPendingForTools.length > 0) {
              ctx.pendingQueueRef.current.delete(subConvId);
              const subPendingText = subPendingForTools
                .map((item) => item.text)
                .join("\n\n");
              ctx.setActivePendingMessages([]);
              const subPendingUserMsg: ChatConversationMessage = {
                id: createMessageId("user"),
                role: "user",
                content: subPendingText,
                timestamp: formatMessageTime(),
                status: "sent",
              };
              ctx.updateSessionMessages(subConvId, (currentMessages) => [
                ...currentMessages,
                subPendingUserMsg,
              ]);
              subNextMessages.push({ role: "user", content: subPendingText });
            }

            return subAgentRunLoop(subNextMessages);
          };

          const summary = await subAgentRunLoop([
            { role: "user", content: prompt },
          ]);

          const subFinalRef = ctx.sessionsRefData.current.get(subConvId);
          if (subFinalRef) {
            subFinalRef.isSending = false;
          }
          ctx.updateSessionField(subConvId, "isStreaming", false);
          ctx.updateSessionField(subConvId, "isAborting", false);
          ctx.removeStreamingId(subConvId);

          const subPendingQueue =
            ctx.pendingQueueRef.current.get(subConvId) ?? [];
          if (!subFinalRef?.isAbortRequested && subPendingQueue.length > 0) {
            ctx.pendingQueueRef.current.delete(subConvId);
            const combined = subPendingQueue
              .map((item) => item.text)
              .join("\n\n");
            const lastOptions =
              subPendingQueue[subPendingQueue.length - 1]?.options ?? {};
            ctx.setActivePendingMessages([]);
            ctx.handleSendMessageRef.current(combined, lastOptions);
          }

          await window.snow.updateSubAgentSessionStatus(
            subConvId,
            "completed",
            ""
          );

          ctx.setSubAgentSessionEvent({
            parentConversationId,
            conversationId: subConversationId,
            agentId,
            agentName: subAgentName,
            status: "completed",
            timestamp: Date.now(),
          });

          return JSON.stringify({
            success: true,
            conversationId: subConversationId,
            agentName: subAgentName,
            summary,
          });
        } catch (err) {
          if (subConversationId) {
            const subCatchRef =
              ctx.sessionsRefData.current.get(subConversationId);
            if (subCatchRef) {
              subCatchRef.isSending = false;
            }
            ctx.updateSessionField(subConversationId, "isStreaming", false);
            ctx.updateSessionField(subConversationId, "isAborting", false);
            ctx.removeStreamingId(subConversationId);

            await window.snow
              .updateSubAgentSessionStatus(subConversationId, "failed", "")
              .catch(() => {});

            ctx.setSubAgentSessionEvent({
              parentConversationId,
              conversationId: subConversationId,
              agentId,
              agentName: subAgentName ?? agentId,
              status: "failed",
              timestamp: Date.now(),
            });
          }

          return JSON.stringify({
            success: false,
            error: getErrorMessage(err),
          });
        }
      };

      const runAgentLoop = async (
        currentAssistantMessageId: string,
        requestMessages: {
          role: "user" | "assistant" | "system" | "developer" | "tool";
          content: string;
        }[],
        currentConversationId: string | undefined,
        checkpointId?: string
      ): Promise<void> => {
        const iterSessionKey = currentConversationId ?? PENDING_SESSION_KEY;
        let effectiveKey = iterSessionKey;

        if (ctx.sessionsRefData.current.get(effectiveKey)?.isAbortRequested) {
          return;
        }

        // Reset the real-time token probe at the start of each agent-loop
        // iteration. The Rust backend accumulates tokens from scratch for
        // every `collect_streaming_response` call, so the frontend probe
        // must also start from zero to stay in sync.
        ctx.updateSessionField(effectiveKey, "streamTokenCount", 0);

        const response = await window.snow.createResponseStream(
          {
            messages: requestMessages,
            model: options.model,
            conversationId: currentConversationId,
            directoryId: sessionDirId,
            checkpointId,
            planMode: ctx.planModeRef.current,
          },
          (chunk) => {
            if (
              ctx.sessionsRefData.current.get(effectiveKey)?.isAbortRequested
            ) {
              return;
            }

            // Update the real-time token probe. The Rust backend counts
            // tokens for every streamed delta (content, thinking, and
            // tool-call arguments) and sends the cumulative value in
            // `chunk.streamTokenCount`. We mirror it into session state so
            // the ChatInputView probe stays in sync.
            ctx.updateSessionField(
              effectiveKey,
              "streamTokenCount",
              chunk.streamTokenCount
            );

            ctx.updateSessionMessages(effectiveKey, (currentMessages) =>
              currentMessages.map((currentMessage) => {
                if (currentMessage.id !== currentAssistantMessageId) {
                  return currentMessage;
                }

                if (chunk.retrying) {
                  return {
                    ...currentMessage,
                    isRetrying: true,
                    retryAttempt: chunk.retryAttempt ?? undefined,
                    retryError: chunk.retryError ?? undefined,
                    status: "sending",
                  };
                }

                const existingContent = currentMessage.content;
                const nextContent =
                  chunk.content || `${existingContent}${chunk.contentDelta}`;
                const nextThinking =
                  chunk.thinking ||
                  `${currentMessage.thinking ?? ""}${chunk.thinkingDelta}`;

                return {
                  ...currentMessage,
                  content: nextContent,
                  thinking: nextThinking || undefined,
                  timestamp: formatMessageTime(),
                  status: "sending",
                  isRetrying: false,
                };
              })
            );
          },
          (streamId: string) => {
            const ref = ctx.sessionsRefData.current.get(effectiveKey);
            if (ref) {
              ref.streamId = streamId;
              if (ref.isAbortRequested) {
                void window.snow.abortResponseStream(streamId);
              }
            }
          }
        );

        const ref = ctx.sessionsRefData.current.get(effectiveKey);
        if (ref) {
          ref.streamId = null;
        }

        if (response.conversationId) {
          if (effectiveKey === PENDING_SESSION_KEY) {
            ctx.migrateSession(PENDING_SESSION_KEY, response.conversationId);
            effectiveKey = response.conversationId;
            finalSessionKey = response.conversationId;
            // Only set active conversation on the first iteration when
            // migrating from pending. Subsequent tool iterations must NOT
            // override the active conversation — the user may have switched
            // to a different conversation while tools are running.
            if (ctx.activeConversationIdRef.current === undefined) {
              ctx.setActiveId(response.conversationId);
            }
          }
          // First message: immediately upsert the new conversation into
          // the list so it appears while AI is still responding.
          if (isFirstMessage) {
            void window.snow
              .getChatConversation(response.conversationId)
              .then((conv) => {
                if (conv) {
                  ctx.setUpsertedConversation({
                    record: conv,
                    timestamp: Date.now(),
                  });
                }
              })
              .catch(() => {
                // Upsert failure should not block the conversation
              });
          }
        }

        if (response.tokenUsage && response.status !== "error") {
          ctx.updateSessionField(
            effectiveKey,
            "tokenUsage",
            response.tokenUsage
          );
        }

        // Auto-compaction check: when the active API config has
        // enableAutoCompress=true and the total token usage exceeds the
        // configured threshold, compact the context so the AI loop can
        // continue without hitting the context window limit.
        //
        // The compaction summary is appended as a new user message in the
        // database (handled by performCompaction). We then start a fresh
        // runAgentLoop iteration with the compacted context so the AI
        // picks up from the summary and continues working.
        if (
          response.tokenUsage &&
          response.status !== "error" &&
          effectiveKey !== PENDING_SESSION_KEY &&
          !ctx.sessionsRefData.current.get(effectiveKey)?.hasAutoCompacted
        ) {
          const apiConfig = ctx.activeApiConfigRef.current;
          if (apiConfig?.enableAutoCompress) {
            const thresholdTokens = calculateAutoCompressThresholdTokens(
              apiConfig.maxContextTokens,
              apiConfig.autoCompressThreshold
            );
            if (thresholdTokens != null && thresholdTokens > 0) {
              const totalTokens =
                response.tokenUsage.inputTokens +
                response.tokenUsage.outputTokens;
              if (totalTokens >= thresholdTokens) {
                const sessionRefForAuto =
                  ctx.sessionsRefData.current.get(effectiveKey);
                if (sessionRefForAuto) {
                  sessionRefForAuto.hasAutoCompacted = true;
                }

                const compactionSummary =
                  await ctx.performCompactionRef.current(
                    effectiveKey,
                    options.model,
                    true
                  );

                if (compactionSummary) {
                  if (
                    ctx.sessionsRefData.current.get(effectiveKey)
                      ?.isAbortRequested
                  ) {
                    return;
                  }

                  // Start a new agent loop iteration with the compacted
                  // context. The Rust backend uses conversationId to
                  // reconstruct context from the database, so the
                  // compaction summary message is automatically included.
                  const postCompactionAssistantId =
                    createMessageId("assistant");
                  const postCompactionAssistant: ChatConversationMessage = {
                    id: postCompactionAssistantId,
                    role: "assistant",
                    content: "",
                    timestamp: formatMessageTime(),
                    status: "sending",
                    model: options.model,
                  };
                  ctx.updateSessionMessages(effectiveKey, (currentMessages) => [
                    ...currentMessages,
                    postCompactionAssistant,
                  ]);
                  await runAgentLoop(
                    postCompactionAssistantId,
                    [{ role: "user", content: compactionSummary }],
                    response.conversationId
                  );
                  return;
                }

                // Compaction failed — reset the flag so it can retry later.
                if (sessionRefForAuto) {
                  sessionRefForAuto.hasAutoCompacted = false;
                }
              }
            }
          }
        }

        if (ctx.sessionsRefData.current.get(effectiveKey)?.isAbortRequested) {
          return;
        }

        // Parse tool calls from response. Mark the first call as running immediately
        // so expensive commands are visible before execution begins; later calls stay
        // pending until the sequential executor reaches them.
        const toolCalls = parseToolCalls(response.toolCallsJson);
        const visibleToolCalls = toolCalls;

        // Update assistant message with the persisted result. Failed responses
        // still migrate the session, but remain visible locally as an error.
        // Note: "incomplete" status (stream interrupted mid-response) is NOT
        // treated as a hard failure — if tool calls were collected before the
        // interruption, we still process them so the agent loop can continue.
        const responseFailed = response.status === "error";
        ctx.updateSessionMessages(effectiveKey, (currentMessages) =>
          currentMessages.map((currentMessage) => {
            if (currentMessage.id !== currentAssistantMessageId) {
              return currentMessage;
            }

            return {
              ...currentMessage,
              content: response.content || currentMessage.content || "",
              thinking:
                response.thinking || currentMessage.thinking || undefined,
              timestamp: formatMessageTime(),
              status: responseFailed ? "error" : "sent",
              responseId: response.id || undefined,
              model: response.model || options.model,
              toolCalls:
                visibleToolCalls.length > 0 ? visibleToolCalls : undefined,
              isRetrying: false,
            };
          })
        );

        if (responseFailed) {
          return;
        }

        // If no tool calls, check for pending user messages before finishing.
        // This injects messages queued during AI streaming without waiting for
        // the entire outer handleSendMessage to complete.
        if (toolCalls.length === 0) {
          const pendingQueueNoTools =
            ctx.pendingQueueRef.current.get(effectiveKey) ?? [];
          if (pendingQueueNoTools.length > 0) {
            ctx.pendingQueueRef.current.delete(effectiveKey);
            const pendingText = pendingQueueNoTools
              .map((item) => item.text)
              .join("\n\n");
            ctx.setActivePendingMessages([]);

            const pendingUserMsg: ChatConversationMessage = {
              id: createMessageId("user"),
              role: "user",
              content: pendingText,
              timestamp: formatMessageTime(),
              status: "sent",
            };
            const nextAssistantId = createMessageId("assistant");
            const nextPendingAssistant: ChatConversationMessage = {
              id: nextAssistantId,
              role: "assistant",
              content: "",
              timestamp: formatMessageTime(),
              status: "sending",
              model: options.model,
            };
            ctx.updateSessionMessages(effectiveKey, (currentMessages) => [
              ...currentMessages,
              pendingUserMsg,
              nextPendingAssistant,
            ]);
            await runAgentLoop(
              nextAssistantId,
              [{ role: "user", content: pendingText }],
              response.conversationId
            );
          }
          return;
        }

        // A tool-call response must always be processed into tool results and
        // followed by another model request. The loop naturally finishes only
        // when a later response contains no tool calls, or when the user cancels.
        const authorizationDecisions = await requestToolAuthorizations(
          toolCalls,
          effectiveKey,
          sessionDirId
        );

        const toolResults: string[] = [];
        let userQuestionCancelled = false;
        for (let toolIndex = 0; toolIndex < toolCalls.length; toolIndex++) {
          const toolCall = toolCalls[toolIndex];
          if (ctx.sessionsRefData.current.get(effectiveKey)?.isAbortRequested) {
            return;
          }

          if (userQuestionCancelled) {
            const skippedResult = JSON.stringify({
              cancelled: true,
              skipped: true,
              reason: "Skipped because the user cancelled the question",
            });
            ctx.updateSessionMessages(effectiveKey, (currentMessages) =>
              currentMessages.map((currentMessage) => {
                if (currentMessage.id !== currentAssistantMessageId) {
                  return currentMessage;
                }

                return {
                  ...currentMessage,
                  toolCalls: updateFirstMatchingToolCall(
                    currentMessage.toolCalls,
                    toolCall,
                    ["pending", "running"],
                    (currentToolCall) => ({
                      ...currentToolCall,
                      status: "completed" as const,
                      result: skippedResult,
                    })
                  ),
                };
              })
            );
            const skippedIdentifier = toolCall.callId
              ? `${toolCall.name}#${toolCall.callId}`
              : toolCall.name;
            toolResults.push(`[Tool: ${skippedIdentifier}]\n${skippedResult}`);
            continue;
          }

          let result: string | undefined;
          const authorizationDecision = authorizationDecisions[toolIndex];

          // Plan Mode gate: block mutating tools until the user explicitly
          // approves the plan via askUserQuestion. Read-only tools and writes
          // to .snow/plan/** are allowed.
          const planGate = evaluatePlanGate({
            planMode: ctx.planModeRef.current,
            planApproved: planApprovedRef.current,
            toolName: toolCall.name,
            args: (() => {
              try {
                return JSON.parse(toolCall.arguments);
              } catch {
                return undefined;
              }
            })(),
          });
          if (!planGate.allow) {
            result = JSON.stringify({
              success: false,
              error: "PLAN_GATE_BLOCKED",
              message: planGate.message,
              toolName: toolCall.name,
            });

            ctx.updateSessionMessages(effectiveKey, (currentMessages) =>
              currentMessages.map((currentMessage) => {
                if (currentMessage.id !== currentAssistantMessageId) {
                  return currentMessage;
                }

                return {
                  ...currentMessage,
                  toolCalls: updateFirstMatchingToolCall(
                    currentMessage.toolCalls,
                    toolCall,
                    ["pending", "running"],
                    (currentToolCall) => ({
                      ...currentToolCall,
                      status: "error" as const,
                      result,
                    })
                  ),
                };
              })
            );
          } else if (authorizationDecision.status === "rejected") {
            const rejectionReason =
              authorizationDecision.reason || "User declined tool execution";
            result = JSON.stringify({
              success: false,
              error: "TOOL_EXECUTION_DENIED_BY_USER",
              message: `Tool execution rejected by user. Reason: ${rejectionReason}`,
              reason: rejectionReason,
              toolName: toolCall.name,
            });

            ctx.updateSessionMessages(effectiveKey, (currentMessages) =>
              currentMessages.map((currentMessage) => {
                if (currentMessage.id !== currentAssistantMessageId) {
                  return currentMessage;
                }

                return {
                  ...currentMessage,
                  toolCalls: updateFirstMatchingToolCall(
                    currentMessage.toolCalls,
                    toolCall,
                    ["pending", "running"],
                    (currentToolCall) => ({
                      ...currentToolCall,
                      status: "error" as const,
                      result,
                    })
                  ),
                };
              })
            );
          } else {
            const validationError = validateToolCall(toolCall);
            if (validationError) {
              result = validationError;
            } else {
              ctx.updateSessionMessages(effectiveKey, (currentMessages) =>
                currentMessages.map((currentMessage) => {
                  if (currentMessage.id !== currentAssistantMessageId) {
                    return currentMessage;
                  }

                  return {
                    ...currentMessage,
                    toolCalls: updateFirstMatchingToolCall(
                      currentMessage.toolCalls,
                      toolCall,
                      "pending",
                      (currentToolCall) => ({
                        ...currentToolCall,
                        status: "running" as const,
                      })
                    ),
                  };
                })
              );

              try {
                const checkpointIds =
                  ctx.sessionsRefData.current.get(effectiveKey)
                    ?.checkpointIds ?? [];

                // Force-override sessionId for todo-manage. Only add actions
                // receive responseId, because rollback tracking applies solely
                // to TODO items created by that action.
                let toolArgs = toolCall.arguments;
                if (
                  toolCall.name === "mcp__todo__todo-manage" &&
                  effectiveKey !== PENDING_SESSION_KEY
                ) {
                  try {
                    const parsedArgs = JSON.parse(toolArgs) as Record<
                      string,
                      unknown
                    >;
                    parsedArgs.sessionId = effectiveKey;
                    if (parsedArgs.action === "add" && response.id) {
                      parsedArgs.responseId = response.id;
                    }
                    toolArgs = JSON.stringify(parsedArgs);
                  } catch {
                    // If args are not valid JSON, let the tool fail naturally.
                  }
                }

                let sensitiveAuthorizationToken: string | undefined;
                if (
                  toolCall.name === "mcp__bash__terminal-execute" &&
                  authorizationDecision.status === "approved" &&
                  authorizationDecision.sensitiveCommandConfirmed === true
                ) {
                  const parsedArgs = JSON.parse(toolArgs) as Record<
                    string,
                    unknown
                  >;
                  if (typeof parsedArgs.command !== "string") {
                    throw new Error("Sensitive command argument is missing");
                  }
                  sensitiveAuthorizationToken =
                    await window.snow.issueSensitiveCommandAuthorization(
                      parsedArgs.command
                    );
                }

                const isUserQuestionTool =
                  toolCall.name === "mcp__user-interaction__askUserQuestion";
                if (isUserQuestionTool) {
                  ctx.userQuestionTargetRef.current.set(
                    toolCall.interactionId,
                    {
                      sessionKey: effectiveKey,
                      assistantMessageId: currentAssistantMessageId,
                    }
                  );
                }

                try {
                  if (
                    toolCall.name === "mcp__sub-agents__activate" &&
                    effectiveKey !== PENDING_SESSION_KEY
                  ) {
                    result = await executeSubAgentActivation(
                      toolArgs,
                      effectiveKey!,
                      sessionDirId ?? ctx.directoryId ?? ""
                    );
                  } else {
                    // Execute beforeToolCall hooks (with matcher) before calling the tool
                    try {
                      const beforeHookContext = JSON.stringify({
                        toolName: toolCall.name,
                        args: JSON.parse(toolArgs),
                        cwd: ctx.directoryPath ?? "",
                      });
                      const beforeHookResult = await window.snow.executeHooks({
                        hookType: "beforeToolCall",
                        projectId: sessionDirId ?? undefined,
                        contextJson: beforeHookContext,
                      });
                      if (beforeHookResult.blocked) {
                        result = JSON.stringify({
                          success: false,
                          error:
                            beforeHookResult.blockMessage ||
                            "Tool call blocked by beforeToolCall hook",
                        });
                      }
                    } catch {
                      // Hook execution failed — continue with tool call
                    }

                    if (result === undefined) {
                      result = await window.snow.callMcpTool(
                        toolCall.name,
                        toolArgs,
                        sessionDirId,
                        checkpointIds,
                        checkpointIds.length > 0
                          ? ctx.directoryPath
                          : undefined,
                        sensitiveAuthorizationToken,
                        (chunk) => {
                          if (!chunk.data) {
                            return;
                          }

                          ctx.updateSessionMessages(
                            effectiveKey,
                            (currentMessages) =>
                              currentMessages.map((currentMessage) => {
                                if (
                                  currentMessage.id !==
                                  currentAssistantMessageId
                                ) {
                                  return currentMessage;
                                }

                                return {
                                  ...currentMessage,
                                  toolCalls: updateFirstMatchingToolCall(
                                    currentMessage.toolCalls,
                                    toolCall,
                                    ["pending", "running"],
                                    (currentToolCall) => ({
                                      ...currentToolCall,
                                      streamingStdout:
                                        chunk.stream === "stdout"
                                          ? `${
                                              currentToolCall.streamingStdout ??
                                              ""
                                            }${chunk.data}`
                                          : currentToolCall.streamingStdout,
                                      streamingStderr:
                                        chunk.stream === "stderr"
                                          ? `${
                                              currentToolCall.streamingStderr ??
                                              ""
                                            }${chunk.data}`
                                          : currentToolCall.streamingStderr,
                                    })
                                  ),
                                };
                              })
                          );
                        },
                        toolCall.interactionId
                      );
                    }

                    // Execute afterToolCall hooks (with matcher) after the tool call completes
                    if (result !== undefined) {
                      try {
                        const afterHookContext = JSON.stringify({
                          toolName: toolCall.name,
                          args: JSON.parse(toolArgs),
                          result: JSON.parse(result),
                          cwd: ctx.directoryPath ?? "",
                        });
                        const afterHookResult = await window.snow.executeHooks({
                          hookType: "afterToolCall",
                          projectId: sessionDirId ?? undefined,
                          contextJson: afterHookContext,
                        });
                        if (afterHookResult.blocked) {
                          result = JSON.stringify({
                            success: false,
                            error:
                              afterHookResult.blockMessage ||
                              "Tool result blocked by afterToolCall hook",
                          });
                        }
                      } catch {
                        // Hook execution failed — keep original result
                      }
                    }
                  } // end of else (non-sub-agent tool call)
                } finally {
                  if (isUserQuestionTool) {
                    ctx.userQuestionTargetRef.current.delete(
                      toolCall.interactionId
                    );
                  }
                }
              } catch (err) {
                result = JSON.stringify({ error: getErrorMessage(err) });
              }
            }

            ctx.updateSessionMessages(effectiveKey, (currentMessages) =>
              currentMessages.map((currentMessage) => {
                if (currentMessage.id !== currentAssistantMessageId) {
                  return currentMessage;
                }

                return {
                  ...currentMessage,
                  toolCalls: updateFirstMatchingToolCall(
                    currentMessage.toolCalls,
                    toolCall,
                    ["pending", "running"],
                    (currentToolCall) => ({
                      ...currentToolCall,
                      status: "completed" as const,
                      result,
                    })
                  ),
                };
              })
            );
          }

          if (
            toolCall.name === "mcp__user-interaction__askUserQuestion" &&
            isUserQuestionCancellationResult(result!)
          ) {
            userQuestionCancelled = true;
          }

          // Plan Mode: detect explicit plan approval from askUserQuestion
          // results. When the user approves the plan, set planApprovedRef to
          // true so subsequent tool calls are no longer blocked by the gate.
          if (
            ctx.planModeRef.current &&
            !planApprovedRef.current &&
            isPlanApprovalResult(toolCall.name, result!)
          ) {
            planApprovedRef.current = true;
          }

          const toolResultIdentifier = toolCall.callId
            ? `${toolCall.name}#${toolCall.callId}`
            : toolCall.name;
          const modelToolResult = formatMcpToolResultForModel(result!);
          toolResults.push(
            `[Tool: ${toolResultIdentifier}]\n${modelToolResult}`
          );

          if (ctx.sessionsRefData.current.get(effectiveKey)?.isAbortRequested) {
            return;
          }
        }

        // Add tool results as a tool message for the next iteration
        const toolResultMessageId = createMessageId("tool");
        const toolResultContent = toolResults.join("\n\n");
        const toolResultMessage: ChatConversationMessage = {
          id: toolResultMessageId,
          role: "tool",
          content: toolResultContent,
          timestamp: formatMessageTime(),
          status: "sent",
          toolName: toolCalls.map((tc) => tc.name).join(", "),
        };

        ctx.updateSessionMessages(effectiveKey, (currentMessages) => [
          ...currentMessages,
          toolResultMessage,
        ]);

        if (userQuestionCancelled) {
          ctx.pendingQueueRef.current.delete(effectiveKey);
          ctx.setActivePendingMessages([]);
          if (response.conversationId) {
            await window.snow.appendToolMessage(
              response.conversationId,
              toolResultContent
            );
          }
          return;
        }

        // Continue the loop with tool results sent as role: "tool"
        // The Rust side (conversation.rs normalize_role) maps "tool" -> "user"
        // when sending to the AI API, but stores it as "tool" in the database.
        // Flush pending user messages before adding the next assistant placeholder so
        // they are sent in the next request as soon as the tool batch finishes.
        const pendingQueueForTools =
          ctx.pendingQueueRef.current.get(effectiveKey) ?? [];
        const nextMessages: {
          role: "user" | "assistant" | "system" | "developer" | "tool";
          content: string;
        }[] = [{ role: "tool", content: toolResultContent }];
        if (pendingQueueForTools.length > 0) {
          ctx.pendingQueueRef.current.delete(effectiveKey);
          const pendingText = pendingQueueForTools
            .map((item) => item.text)
            .join("\n\n");
          ctx.setActivePendingMessages([]);
          const pendingUserMsgForTools: ChatConversationMessage = {
            id: createMessageId("user"),
            role: "user",
            content: pendingText,
            timestamp: formatMessageTime(),
            status: "sent",
          };
          ctx.updateSessionMessages(effectiveKey, (currentMessages) => [
            ...currentMessages,
            pendingUserMsgForTools,
          ]);
          nextMessages.push({ role: "user", content: pendingText });
        }

        const newAssistantMessageId = createMessageId("assistant");
        const newPendingAssistant: ChatConversationMessage = {
          id: newAssistantMessageId,
          role: "assistant",
          content: "",
          timestamp: formatMessageTime(),
          status: "sending",
          model: options.model,
        };
        ctx.updateSessionMessages(effectiveKey, (currentMessages) => [
          ...currentMessages,
          newPendingAssistant,
        ]);

        await runAgentLoop(
          newAssistantMessageId,
          nextMessages,
          response.conversationId
        );
      };

      // Create a file-system checkpoint before the AI loop starts so that
      // rollback can restore the working directory to this pre-AI state.
      // The checkpoint is awaited before runAgentLoop to guarantee the AI
      // cannot modify files before the snapshot is captured.
      const initCheckpointAndRun = async (): Promise<void> => {
        // Pre-send auto-compaction: if the existing context already exceeds
        // the configured threshold, compact first so the new user message is
        // sent against a fresh, summarized context. This applies both to
        // direct user sends and to pending-message flushes (which re-enter
        // handleSendMessage via handleSendMessageRef).
        if (
          sessionKey !== PENDING_SESSION_KEY &&
          !ctx.sessionsRefData.current.get(sessionKey)?.hasAutoCompacted
        ) {
          const apiConfig = ctx.activeApiConfigRef.current;
          if (apiConfig?.enableAutoCompress) {
            const thresholdTokens = calculateAutoCompressThresholdTokens(
              apiConfig.maxContextTokens,
              apiConfig.autoCompressThreshold
            );
            if (thresholdTokens != null && thresholdTokens > 0) {
              const currentTokenUsage =
                ctx.sessionsRef.current?.[sessionKey]?.tokenUsage ?? null;
              if (currentTokenUsage) {
                const totalTokens =
                  currentTokenUsage.inputTokens +
                  currentTokenUsage.outputTokens;
                if (totalTokens >= thresholdTokens) {
                  const compactionSummary =
                    await ctx.performCompactionRef.current(
                      sessionKey,
                      options.model,
                      true
                    );

                  // performCompaction resets sessionRef.isSending to false in
                  // its finally block, but we are still mid-send — restore it
                  // so the outer handleSendMessage flow keeps the session
                  // locked until it finishes.
                  const sessionRefAfterCompaction =
                    ctx.sessionsRefData.current.get(sessionKey);
                  if (sessionRefAfterCompaction) {
                    sessionRefAfterCompaction.isSending = true;
                    sessionRefAfterCompaction.isAbortRequested = false;
                  }

                  // If the user aborted during compaction, stop here
                  // regardless of whether compaction succeeded.
                  if (
                    ctx.sessionsRefData.current.get(sessionKey)
                      ?.isAbortRequested
                  ) {
                    return;
                  }

                  // Mark the session as auto-compacted so the in-loop
                  // post-response compaction check does not trigger again
                  // for this turn.
                  if (compactionSummary && sessionRefAfterCompaction) {
                    sessionRefAfterCompaction.hasAutoCompacted = true;
                  }
                }
              }
            }
          }
        }

        let checkpointId: string | undefined;
        if (ctx.directoryPath && !ctx.directoryPath.startsWith("ssh://")) {
          try {
            checkpointId = await window.snow.createCheckpoint(
              ctx.directoryPath
            );
            const ref = ctx.sessionsRefData.current.get(sessionKey);
            if (ref) {
              ref.checkpointIds = [...ref.checkpointIds, checkpointId];
            }
            ctx.updateSessionMessages(sessionKey, (currentMessages) =>
              currentMessages.map((m) =>
                m.id === userMessage.id ? { ...m, checkpointId } : m
              )
            );
          } catch {
            // Best effort — continue without a checkpoint
          }
        }

        // Execute onUserMessage hooks before sending the message to the AI.
        // Hooks run in the Rust backend (spawn_blocking) and may modify the
        // message content via soft signal (exit code 1) or block it (exit >= 2).
        try {
          const hookContext = JSON.stringify({
            message: trimmed,
            cwd: ctx.directoryPath ?? "",
            sessionId:
              sessionKey === PENDING_SESSION_KEY ? undefined : sessionKey,
          });
          const hookResult = await window.snow.executeHooks({
            hookType: "onUserMessage",
            projectId: sessionDirId ?? undefined,
            contextJson: hookContext,
          });
          if (hookResult.blocked) {
            ctx.updateSessionMessages(finalSessionKey, (currentMessages) =>
              currentMessages.map((currentMessage) =>
                currentMessage.id === assistantMessageId
                  ? {
                      ...currentMessage,
                      content:
                        hookResult.blockMessage ||
                        "Message blocked by onUserMessage hook",
                      timestamp: formatMessageTime(),
                      status: "error",
                      isRetrying: false,
                    }
                  : currentMessage
              )
            );
            return;
          }
          // Collect additional context from hook results (context/command output)
          const additionalContext = hookResult.results
            .map((r) => r.additionalContext)
            .filter((ctx): ctx is string => Boolean(ctx))
            .join("\n");
          const effectiveMessage = additionalContext
            ? `${trimmed}\n\n[Hook Context]\n${additionalContext}`
            : trimmed;
          await runAgentLoop(
            assistantMessageId,
            [{ role: "user", content: effectiveMessage }],
            sessionKey === PENDING_SESSION_KEY ? undefined : sessionKey,
            checkpointId
          );
        } catch (hookError) {
          // If hook execution fails, fall back to sending the original message
          await runAgentLoop(
            assistantMessageId,
            [{ role: "user", content: trimmed }],
            sessionKey === PENDING_SESSION_KEY ? undefined : sessionKey,
            checkpointId
          );
        }
      };

      void initCheckpointAndRun()
        .catch((error: unknown) => {
          ctx.updateSessionField(finalSessionKey, "isStreaming", false);
          const ref = ctx.sessionsRefData.current.get(finalSessionKey);
          if (ref) {
            ref.streamId = null;
          }
          ctx.updateSessionMessages(finalSessionKey, (currentMessages) =>
            currentMessages.map((currentMessage) =>
              currentMessage.status === "sending"
                ? {
                    ...currentMessage,
                    content: getErrorMessage(error),
                    timestamp: formatMessageTime(),
                    status: "error",
                    isRetrying: false,
                  }
                : currentMessage
            )
          );
        })
        .finally(() => {
          const ref = ctx.sessionsRefData.current.get(finalSessionKey);
          if (ref) {
            ref.isSending = false;
          }
          ctx.updateSessionField(finalSessionKey, "isStreaming", false);
          ctx.updateSessionField(finalSessionKey, "isAborting", false);
          ctx.removeStreamingId(finalSessionKey);

          // Flush pending messages queued while this session was busy.
          const pendingQueue =
            ctx.pendingQueueRef.current.get(finalSessionKey) ?? [];
          if (!ref?.isAbortRequested && pendingQueue.length > 0) {
            ctx.pendingQueueRef.current.delete(finalSessionKey);
            const combined = pendingQueue.map((item) => item.text).join("\n\n");
            const lastOptions =
              pendingQueue[pendingQueue.length - 1]?.options ?? {};
            ctx.setActivePendingMessages([]);
            ctx.handleSendMessageRef.current(combined, lastOptions);
          }

          // If this is a background conversation (not the active one),
          // mark it as completed so the sidebar shows a dot indicator.
          if (
            finalSessionKey !== PENDING_SESSION_KEY &&
            finalSessionKey !== ctx.activeConversationIdRef.current
          ) {
            ctx.updateSessionField(finalSessionKey, "hasNewContent", true);
            ctx.setCompletedConversationIds((prev) => {
              if (prev.has(finalSessionKey)) return prev;
              const next = new Set(prev);
              next.add(finalSessionKey);
              return next;
            });
          }

          // First message: generate summary asynchronously, then upsert
          // again to update the conversation title.
          if (isFirstMessage && finalSessionKey !== PENDING_SESSION_KEY) {
            const currentId = finalSessionKey;

            void window.snow
              .generateConversationSummary(currentId)
              .then((generatedSummary) => {
                if (generatedSummary) {
                  ctx.updateSessionField(
                    currentId,
                    "summary",
                    generatedSummary
                  );
                  return window.snow.getChatConversation(currentId);
                }
                return null;
              })
              .then((updated) => {
                if (updated) {
                  ctx.setUpsertedConversation({
                    record: updated,
                    timestamp: Date.now(),
                  });
                }
              })
              .catch(() => {
                // Summary generation failure should not block the conversation
              });
          }

          // 通知系统：AI 流程正常结束时触发系统通知。
          // 窗口是否聚焦的判断由主进程 notificationManager 负责 —
          // 如果用户正在看应用，主进程会自动跳过通知，不会打扰。
          if (
            finalSessionKey !== PENDING_SESSION_KEY &&
            !ref?.isAbortRequested
          ) {
            const sessionState = ctx.sessionsRef.current?.[finalSessionKey];
            ctx.notifyAiComplete(sessionState?.summary || undefined);
          }
        });
    },
    [
      ctx.directoryId,
      ctx.directoryPath,
      ctx.ensureSession,
      ctx.updateSessionMessages,
      ctx.updateSessionField,
      ctx.migrateSession,
      ctx.addStreamingId,
      ctx.removeStreamingId,
      ctx.setActiveId,
      ctx.notifyAiComplete,
      requestToolAuthorizations,
    ]
  );

  // Keep the ref current so the pending-flush closure always calls the latest version.
  ctx.handleSendMessageRef.current = handleSendMessage;

  return { handleSendMessage };
};
