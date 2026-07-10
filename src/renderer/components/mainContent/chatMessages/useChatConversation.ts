import { useCallback, useRef, useState } from "react";
import type { ChatInputSendOptions } from "../chatInput/types";
import type {
  ChatConversationRecord,
  CheckpointFileChange,
  TokenUsage,
} from "../../../../preload";

export type ToolCallInfo = {
  name: string;
  arguments: string;
  callId?: string;
  status: "pending" | "running" | "completed" | "error";
  result?: string;
  streamingStdout?: string;
  streamingStderr?: string;
};

export type ChatConversationMessage = {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  thinking?: string;
  timestamp: string;
  status?: "sending" | "sent" | "error";
  responseId?: string;
  model?: string;
  toolCalls?: ToolCallInfo[];
  toolCallId?: string;
  toolName?: string;
  /** File-system checkpoint id created when the user sent this message.
   *  Used by rollback to restore the working directory to its pre-AI state. */
  checkpointId?: string;
};

type UpsertedConversation = {
  record: ChatConversationRecord;
  timestamp: number;
};

type ConversationSessionState = {
  messages: ChatConversationMessage[];
  summary: string;
  isStreaming: boolean;
  isAborting: boolean;
  tokenUsage: TokenUsage | null;
  directoryId?: string;
  hasNewContent: boolean;
  forkedFromConversationId?: string;
  forkMessageCount?: number;
};

type ConversationSessionRef = {
  streamId: string | null;
  isSending: boolean;
  directoryId?: string;
  checkpointIds: string[];
};

type RollbackPreview = {
  messageId: string;
  messageContent: string;
  changes: CheckpointFileChange[];
  checkpointId?: string;
  workDir?: string;
  convId?: string;
  responseId?: string;
  isFirstMessage: boolean;
};

type UseChatConversationResult = {
  messages: ChatConversationMessage[];
  summary: string;
  conversationVersion: number;
  upsertedConversation: UpsertedConversation | null;
  activeConversationId: string | undefined;
  conversationDirectoryId: string | undefined;
  tokenUsage: TokenUsage | null;
  forkedFromConversationId: string | undefined;
  forkMessageCount: number | undefined;
  streamingConversationIds: Set<string>;
  completedConversationIds: Set<string>;
  handleSendMessage: (message: string, options: ChatInputSendOptions) => void;
  handleSelectConversation: (
    conversationId: string,
    title?: string,
    tokenUsage?: TokenUsage | null,
    directoryId?: string
  ) => Promise<void>;
  handleNewChat: () => void;
  refreshConversations: () => void;
  isStreaming: boolean;
  isAborting: boolean;
  handleAbort: () => void;
  abortConversation: (conversationId: string) => void;
  handleForkConversation: (
    conversationId: string,
    upToResponseId: string
  ) => Promise<void>;
  draftToRestore: string | null;
  clearDraftToRestore: () => void;
  handleRollback: (messageId: string) => void;
  rollbackPreview: RollbackPreview | null;
  confirmRollback: () => void;
  cancelRollback: () => void;
};

const PENDING_SESSION_KEY = "__pending__";

const deleteCheckpoints = (checkpointIds: string[]): void => {
  for (const checkpointId of checkpointIds) {
    void window.snow.deleteCheckpoint(checkpointId).catch(() => {
      // Checkpoint cleanup is best effort.
    });
  }
};

const formatMessageTime = (): string =>
  new Date().toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });

const createMessageId = (role: ChatConversationMessage["role"]): string =>
  `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "AI 响应失败，请稍后重试。";

const normalizeToolCallArguments = (args: unknown): string => {
  if (typeof args === "string") {
    return args;
  }
  if (typeof args === "object" && args !== null) {
    return JSON.stringify(args);
  }
  return "{}";
};

const isValidToolName = (name: string): boolean => {
  // Valid format: mcp__{server_id}__{tool_name}
  const parts = name.split("__");
  return (
    parts.length === 3 &&
    parts[0] === "mcp" &&
    parts[1].length > 0 &&
    parts[2].length > 0
  );
};

const normalizeToolCallName = (tc: Record<string, unknown>): string => {
  const directName = typeof tc.name === "string" ? tc.name.trim() : "";
  if (directName) {
    return directName;
  }
  const func = tc.function;
  if (typeof func === "object" && func !== null && !Array.isArray(func)) {
    const funcRecord = func as Record<string, unknown>;
    return typeof funcRecord.name === "string" ? funcRecord.name.trim() : "";
  }
  return "";
};

const normalizeToolCallArgumentsFromTc = (
  tc: Record<string, unknown>
): string => {
  // OpenAI Chat Completions: arguments in tc.function.arguments (string)
  // OpenAI Responses API: arguments in tc.arguments (object)
  // Anthropic: input in tc.input (object)
  // Gemini: args in tc.args (object)
  if (typeof tc.arguments === "string" || typeof tc.arguments === "object") {
    return normalizeToolCallArguments(tc.arguments);
  }
  if (typeof tc.input === "string" || typeof tc.input === "object") {
    return normalizeToolCallArguments(tc.input);
  }
  if (typeof tc.args === "string" || typeof tc.args === "object") {
    return normalizeToolCallArguments(tc.args);
  }
  const func = tc.function;
  if (typeof func === "object" && func !== null && !Array.isArray(func)) {
    const funcRecord = func as Record<string, unknown>;
    return normalizeToolCallArguments(funcRecord.arguments);
  }
  return "{}";
};

const normalizeToolCallId = (
  tc: Record<string, unknown>
): string | undefined => {
  if (typeof tc.call_id === "string") {
    return tc.call_id;
  }
  if (typeof tc.callId === "string") {
    return tc.callId;
  }
  if (typeof tc.id === "string") {
    return tc.id;
  }
  return undefined;
};

const parseToolCalls = (toolCallsJson: string | undefined): ToolCallInfo[] => {
  if (!toolCallsJson) {
    return [];
  }

  try {
    const parsed = JSON.parse(toolCallsJson);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed
        .map((tc: unknown): ToolCallInfo | null => {
          if (typeof tc !== "object" || tc === null || Array.isArray(tc)) {
            return null;
          }
          const record = tc as Record<string, unknown>;
          const name = normalizeToolCallName(record);
          if (!name) {
            return null;
          }
          return {
            name,
            arguments: normalizeToolCallArgumentsFromTc(record),
            callId: normalizeToolCallId(record),
            status: "pending" as const,
          };
        })
        .filter((tc): tc is ToolCallInfo => tc !== null);
    }
  } catch {
    // Not valid JSON, no tool calls
  }

  return [];
};

const isSameToolCall = (
  candidate: ToolCallInfo,
  target: ToolCallInfo
): boolean =>
  target.callId
    ? candidate.callId === target.callId
    : candidate.name === target.name &&
      candidate.arguments === target.arguments;

const updateFirstMatchingToolCall = (
  toolCalls: ToolCallInfo[] | undefined,
  target: ToolCallInfo,
  expectedStatus: ToolCallInfo["status"],
  update: (toolCall: ToolCallInfo) => ToolCallInfo
): ToolCallInfo[] | undefined => {
  if (!toolCalls) {
    return undefined;
  }

  let hasUpdated = false;
  return toolCalls.map((toolCall) => {
    if (
      hasUpdated ||
      toolCall.status !== expectedStatus ||
      !isSameToolCall(toolCall, target)
    ) {
      return toolCall;
    }

    hasUpdated = true;
    return update(toolCall);
  });
};

/**
 * Validate tool call before execution. Returns an error message string if
 * the tool call should not be executed, or null if it is valid.
 *
 * When the AI provides malformed tool names or invalid JSON arguments, we
 * return a descriptive error instead of calling the Rust backend. This error
 * is fed back into the conversation so the AI can self-correct in the next
 * iteration of the agent loop.
 */
const validateToolCall = (toolCall: ToolCallInfo): string | null => {
  if (!isValidToolName(toolCall.name)) {
    return JSON.stringify({
      error: `Invalid tool name format: "${toolCall.name}". Tool names must follow the format "mcp__{server}__{tool}". Please check the available tool definitions and use the correct full name.`,
    });
  }

  // Validate that arguments is parseable JSON
  if (toolCall.arguments) {
    try {
      JSON.parse(toolCall.arguments);
    } catch {
      return JSON.stringify({
        error: `Arguments for tool "${
          toolCall.name
        }" is not valid JSON: ${toolCall.arguments.slice(
          0,
          200
        )}. Please provide arguments as a valid JSON object.`,
      });
    }
  }

  return null;
};

export const useChatConversation = (
  directoryId?: string,
  directoryPath?: string
): UseChatConversationResult => {
  const [sessions, setSessions] = useState<
    Record<string, ConversationSessionState>
  >({});
  const [activeConversationId, setActiveConversationId] = useState<
    string | undefined
  >(undefined);
  const [conversationVersion, setConversationVersion] = useState(0);
  const [upsertedConversation, setUpsertedConversation] =
    useState<UpsertedConversation | null>(null);
  const [streamingConversationIds, setStreamingConversationIds] = useState<
    Set<string>
  >(new Set());
  const [completedConversationIds, setCompletedConversationIds] = useState<
    Set<string>
  >(new Set());
  const [draftToRestore, setDraftToRestore] = useState<string | null>(null);
  const [rollbackPreview, setRollbackPreview] =
    useState<RollbackPreview | null>(null);

  const sessionsRefData = useRef<Map<string, ConversationSessionRef>>(
    new Map()
  );
  const activeConversationIdRef = useRef<string | undefined>(undefined);
  // Keep a ref to the latest sessions so async callbacks (e.g. handleRollback)
  // can read the current messages without stale closures.
  const sessionsRef = useRef<Record<string, ConversationSessionState>>({});
  sessionsRef.current = sessions;

  const setActiveId = useCallback((id: string | undefined): void => {
    activeConversationIdRef.current = id;
    setActiveConversationId(id);
  }, []);

  const ensureSession = useCallback((key: string, dirId?: string): void => {
    if (!sessionsRefData.current.has(key)) {
      sessionsRefData.current.set(key, {
        streamId: null,
        isSending: false,
        directoryId: dirId,
        checkpointIds: [],
      });
    }
    setSessions((prev) => {
      if (prev[key]) return prev;
      return {
        ...prev,
        [key]: {
          messages: [],
          summary: "",
          isStreaming: false,
          isAborting: false,
          tokenUsage: null,
          directoryId: dirId,
          hasNewContent: false,
        },
      };
    });
  }, []);

  const updateSessionMessages = useCallback(
    (
      key: string,
      updater: (
        messages: ChatConversationMessage[]
      ) => ChatConversationMessage[]
    ): void => {
      setSessions((prev) => {
        const session = prev[key];
        if (!session) return prev;
        return {
          ...prev,
          [key]: { ...session, messages: updater(session.messages) },
        };
      });
    },
    []
  );

  const updateSessionField = useCallback(
    <K extends keyof ConversationSessionState>(
      key: string,
      field: K,
      value: ConversationSessionState[K]
    ): void => {
      setSessions((prev) => {
        const session = prev[key];
        if (!session) return prev;
        return { ...prev, [key]: { ...session, [field]: value } };
      });
    },
    []
  );

  const migrateSession = useCallback((oldKey: string, newKey: string): void => {
    const oldRef = sessionsRefData.current.get(oldKey);
    if (oldRef) {
      sessionsRefData.current.set(newKey, { ...oldRef });
      sessionsRefData.current.delete(oldKey);
    }
    setSessions((prev) => {
      const oldSession = prev[oldKey];
      if (!oldSession) return prev;
      const next = { ...prev };
      next[newKey] = oldSession;
      delete next[oldKey];
      return next;
    });
    setStreamingConversationIds((prev) => {
      if (!prev.has(oldKey)) return prev;
      const next = new Set(prev);
      next.delete(oldKey);
      next.add(newKey);
      return next;
    });
  }, []);

  const addStreamingId = useCallback((id: string): void => {
    setStreamingConversationIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const removeStreamingId = useCallback((id: string): void => {
    setStreamingConversationIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const handleSendMessage = useCallback(
    (message: string, options: ChatInputSendOptions) => {
      const trimmed = message.trim();
      if (!trimmed) {
        return;
      }

      const sessionKey = activeConversationIdRef.current ?? PENDING_SESSION_KEY;
      const existingRef = sessionsRefData.current.get(sessionKey);
      if (existingRef?.isSending) {
        return;
      }

      const isFirstMessage = activeConversationIdRef.current === undefined;
      const sessionDirId = existingRef?.directoryId ?? directoryId;

      ensureSession(sessionKey, sessionDirId);
      const sessionRef = sessionsRefData.current.get(sessionKey);
      if (sessionRef) {
        sessionRef.isSending = true;
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

      updateSessionField(sessionKey, "isStreaming", true);
      addStreamingId(sessionKey);
      updateSessionMessages(sessionKey, (currentMessages) => [
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
        setUpsertedConversation({
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

      const MAX_TOOL_ITERATIONS = 10;
      let iteration = 0;

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

        const response = await window.snow.createResponseStream(
          {
            messages: requestMessages,
            model: options.model,
            conversationId: currentConversationId,
            directoryId: sessionDirId,
            checkpointId,
          },
          (chunk) => {
            updateSessionMessages(effectiveKey, (currentMessages) =>
              currentMessages.map((currentMessage) => {
                if (currentMessage.id !== currentAssistantMessageId) {
                  return currentMessage;
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
                };
              })
            );
          },
          (streamId: string) => {
            const ref = sessionsRefData.current.get(effectiveKey);
            if (ref) {
              ref.streamId = streamId;
            }
          }
        );

        const ref = sessionsRefData.current.get(effectiveKey);
        if (ref) {
          ref.streamId = null;
        }

        if (response.conversationId) {
          if (effectiveKey === PENDING_SESSION_KEY) {
            migrateSession(PENDING_SESSION_KEY, response.conversationId);
            effectiveKey = response.conversationId;
            finalSessionKey = response.conversationId;
            // Only set active conversation on the first iteration when
            // migrating from pending. Subsequent tool iterations must NOT
            // override the active conversation — the user may have switched
            // to a different conversation while tools are running.
            if (activeConversationIdRef.current === undefined) {
              setActiveId(response.conversationId);
            }
          }
          // First message: immediately upsert the new conversation into
          // the list so it appears while AI is still responding.
          if (isFirstMessage) {
            void window.snow
              .getChatConversation(response.conversationId)
              .then((conv) => {
                if (conv) {
                  setUpsertedConversation({
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

        if (response.tokenUsage) {
          updateSessionField(effectiveKey, "tokenUsage", response.tokenUsage);
        }

        // Parse tool calls from response. Mark the first call as running immediately
        // so expensive commands are visible before execution begins; later calls stay
        // pending until the sequential executor reaches them.
        const toolCalls = parseToolCalls(response.toolCallsJson);
        const visibleToolCalls = toolCalls.map((toolCall, index) => ({
          ...toolCall,
          status: index === 0 ? ("running" as const) : toolCall.status,
        }));

        // Update assistant message with final content and immediately-visible calls.
        updateSessionMessages(effectiveKey, (currentMessages) =>
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
              status: "sent",
              responseId: response.id,
              model: response.model || options.model,
              toolCalls:
                visibleToolCalls.length > 0 ? visibleToolCalls : undefined,
            };
          })
        );

        // If no tool calls, we're done
        if (toolCalls.length === 0) {
          return;
        }

        // Check iteration limit
        iteration++;
        if (iteration >= MAX_TOOL_ITERATIONS) {
          return;
        }

        // Execute tool calls sequentially and collect results.
        const toolResults: string[] = [];
        for (const [toolIndex, toolCall] of toolCalls.entries()) {
          if (toolIndex > 0) {
            updateSessionMessages(effectiveKey, (currentMessages) =>
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
          }

          let result: string;
          const validationError = validateToolCall(toolCall);
          if (validationError) {
            result = validationError;
          } else {
            try {
              const checkpointIds =
                sessionsRefData.current.get(effectiveKey)?.checkpointIds ?? [];
              result = await window.snow.callMcpTool(
                toolCall.name,
                toolCall.arguments,
                checkpointIds,
                checkpointIds.length > 0 ? directoryPath : undefined,
                (chunk) => {
                  if (!chunk.data) {
                    return;
                  }

                  updateSessionMessages(effectiveKey, (currentMessages) =>
                    currentMessages.map((currentMessage) => {
                      if (currentMessage.id !== currentAssistantMessageId) {
                        return currentMessage;
                      }

                      return {
                        ...currentMessage,
                        toolCalls: updateFirstMatchingToolCall(
                          currentMessage.toolCalls,
                          toolCall,
                          "running",
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
                }
              );
            } catch (err) {
              result = JSON.stringify({ error: getErrorMessage(err) });
            }
          }

          updateSessionMessages(effectiveKey, (currentMessages) =>
            currentMessages.map((currentMessage) => {
              if (currentMessage.id !== currentAssistantMessageId) {
                return currentMessage;
              }

              return {
                ...currentMessage,
                toolCalls: updateFirstMatchingToolCall(
                  currentMessage.toolCalls,
                  toolCall,
                  "running",
                  (currentToolCall) => ({
                    ...currentToolCall,
                    status: "completed" as const,
                    result,
                  })
                ),
              };
            })
          );

          const toolResultIdentifier = toolCall.callId
            ? `${toolCall.name}#${toolCall.callId}`
            : toolCall.name;
          toolResults.push(`[Tool: ${toolResultIdentifier}]\n${result}`);
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

        updateSessionMessages(effectiveKey, (currentMessages) => [
          ...currentMessages,
          toolResultMessage,
        ]);

        // Create new pending assistant message for next iteration
        const newAssistantMessageId = createMessageId("assistant");
        const newPendingAssistant: ChatConversationMessage = {
          id: newAssistantMessageId,
          role: "assistant",
          content: "",
          timestamp: formatMessageTime(),
          status: "sending",
          model: options.model,
        };

        updateSessionMessages(effectiveKey, (currentMessages) => [
          ...currentMessages,
          newPendingAssistant,
        ]);

        // Continue the loop with tool results sent as role: "tool"
        // The Rust side (conversation.rs normalize_role) maps "tool" -> "user"
        // when sending to the AI API, but stores it as "tool" in the database
        await runAgentLoop(
          newAssistantMessageId,
          [{ role: "tool", content: toolResultContent }],
          response.conversationId
        );
      };

      // Create a file-system checkpoint before the AI loop starts so that
      // rollback can restore the working directory to this pre-AI state.
      // The checkpoint is awaited before runAgentLoop to guarantee the AI
      // cannot modify files before the snapshot is captured.
      const initCheckpointAndRun = async (): Promise<void> => {
        let checkpointId: string | undefined;
        if (directoryPath && !directoryPath.startsWith("ssh://")) {
          try {
            checkpointId = await window.snow.createCheckpoint(directoryPath);
            const ref = sessionsRefData.current.get(sessionKey);
            if (ref) {
              ref.checkpointIds = [...ref.checkpointIds, checkpointId];
            }
            updateSessionMessages(sessionKey, (currentMessages) =>
              currentMessages.map((m) =>
                m.id === userMessage.id ? { ...m, checkpointId } : m
              )
            );
          } catch {
            // Best effort — continue without a checkpoint
          }
        }
        await runAgentLoop(
          assistantMessageId,
          [{ role: "user", content: trimmed }],
          sessionKey === PENDING_SESSION_KEY ? undefined : sessionKey,
          checkpointId
        );
      };

      void initCheckpointAndRun()
        .catch((error: unknown) => {
          updateSessionField(finalSessionKey, "isStreaming", false);
          const ref = sessionsRefData.current.get(finalSessionKey);
          if (ref) {
            ref.streamId = null;
          }
          updateSessionMessages(finalSessionKey, (currentMessages) =>
            currentMessages.map((currentMessage) =>
              currentMessage.status === "sending"
                ? {
                    ...currentMessage,
                    content: getErrorMessage(error),
                    timestamp: formatMessageTime(),
                    status: "error",
                  }
                : currentMessage
            )
          );
        })
        .finally(() => {
          const ref = sessionsRefData.current.get(finalSessionKey);
          if (ref) {
            ref.isSending = false;
          }
          updateSessionField(finalSessionKey, "isStreaming", false);
          updateSessionField(finalSessionKey, "isAborting", false);
          removeStreamingId(finalSessionKey);

          // If this is a background conversation (not the active one),
          // mark it as completed so the sidebar shows a dot indicator.
          if (
            finalSessionKey !== PENDING_SESSION_KEY &&
            finalSessionKey !== activeConversationIdRef.current
          ) {
            updateSessionField(finalSessionKey, "hasNewContent", true);
            setCompletedConversationIds((prev) => {
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
                  updateSessionField(currentId, "summary", generatedSummary);
                  return window.snow.getChatConversation(currentId);
                }
                return null;
              })
              .then((updated) => {
                if (updated) {
                  setUpsertedConversation({
                    record: updated,
                    timestamp: Date.now(),
                  });
                }
              })
              .catch(() => {
                // Summary generation failure should not block the conversation
              });
          }
        });
    },
    [
      directoryId,
      directoryPath,
      ensureSession,
      updateSessionMessages,
      updateSessionField,
      migrateSession,
      addStreamingId,
      removeStreamingId,
      setActiveId,
    ]
  );

  const handleSelectConversation = useCallback(
    async (
      conversationId: string,
      title?: string,
      conversationTokenUsage?: TokenUsage | null,
      conversationDirId?: string
    ): Promise<void> => {
      const trimmedId = conversationId.trim();
      if (!trimmedId || trimmedId === activeConversationIdRef.current) {
        return;
      }

      // If session already exists, just switch the active pointer
      // (preserves in-flight streaming without reloading from DB)
      if (sessionsRefData.current.has(trimmedId)) {
        setActiveId(trimmedId);
        // Clear the "new content" indicator when user views this conversation
        updateSessionField(trimmedId, "hasNewContent", false);
        setCompletedConversationIds((prev) => {
          if (!prev.has(trimmedId)) return prev;
          const next = new Set(prev);
          next.delete(trimmedId);
          return next;
        });
        return;
      }

      const nextTitle = title?.trim() ?? "";

      try {
        const [records, conversationRecord] = await Promise.all([
          window.snow.listChatMessages(trimmedId),
          window.snow.getChatConversation(trimmedId),
        ]);

        // Build ordered result queues from tool-role messages. New records include
        // callId in the identifier; legacy records are consumed by tool name order.
        const toolResultQueues = new Map<string, string[]>();
        for (const record of records) {
          if (record.role === "tool" && record.content) {
            for (const segment of record.content.split("\n\n")) {
              const match = segment.match(/^\[Tool:\s*(.+?)\]\n([\s\S]*)$/);
              if (match) {
                const queue = toolResultQueues.get(match[1]) ?? [];
                queue.push(match[2]);
                toolResultQueues.set(match[1], queue);
              }
            }
          }
        }

        const consumeToolResult = (
          toolCall: ToolCallInfo
        ): string | undefined => {
          const identifiers = toolCall.callId
            ? [`${toolCall.name}#${toolCall.callId}`, toolCall.name]
            : [toolCall.name];

          for (const identifier of identifiers) {
            const queue = toolResultQueues.get(identifier);
            if (queue && queue.length > 0) {
              return queue.shift();
            }
          }

          return undefined;
        };

        const loadedMessages: ChatConversationMessage[] = records
          .filter((record) => record.role !== "tool")
          .map((record) => {
            const toolCalls = parseToolCalls(record.toolCallsJson).map((tc) => {
              const result = consumeToolResult(tc);
              return {
                ...tc,
                status:
                  result === undefined
                    ? ("error" as const)
                    : ("completed" as const),
                result,
              };
            });

            return {
              id: record.id,
              role: record.role === "user" ? "user" : "assistant",
              content: record.content,
              thinking: record.thinking || undefined,
              timestamp: record.createdAt,
              status: record.status === "error" ? "error" : "sent",
              responseId: record.responseId || undefined,
              checkpointId: record.checkpointId || undefined,
              model: record.model || undefined,
              toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            };
          });

        const checkpointIds = Array.from(
          new Set(
            records
              .filter((record) => record.role === "user" && record.checkpointId)
              .map((record) => record.checkpointId)
          )
        );

        sessionsRefData.current.set(trimmedId, {
          streamId: null,
          isSending: false,
          directoryId: conversationDirId,
          checkpointIds,
        });
        setSessions((prev) => ({
          ...prev,
          [trimmedId]: {
            messages: loadedMessages,
            summary: nextTitle,
            isStreaming: false,
            isAborting: false,
            tokenUsage: conversationTokenUsage ?? null,
            directoryId: conversationDirId,
            hasNewContent: false,
            forkedFromConversationId:
              conversationRecord?.forkedFromConversationId || undefined,
            forkMessageCount: conversationRecord?.forkMessageCount || undefined,
          },
        }));

        setActiveId(trimmedId);
      } catch {
        // 加载历史消息失败时静默处理，不阻断交互
      }
    },
    [setActiveId, updateSessionField]
  );

  const handleNewChat = useCallback((): void => {
    // Clear stale pending session if not actively streaming
    const pendingRef = sessionsRefData.current.get(PENDING_SESSION_KEY);
    if (pendingRef && !pendingRef.isSending) {
      deleteCheckpoints(pendingRef.checkpointIds);
      sessionsRefData.current.delete(PENDING_SESSION_KEY);
      setSessions((prev) => {
        const next = { ...prev };
        delete next[PENDING_SESSION_KEY];
        return next;
      });
    }
    setActiveId(undefined);
  }, [setActiveId]);

  const handleAbort = useCallback((): void => {
    const key = activeConversationIdRef.current ?? PENDING_SESSION_KEY;
    const ref = sessionsRefData.current.get(key);
    if (!ref?.streamId) {
      return;
    }
    updateSessionField(key, "isStreaming", false);
    updateSessionField(key, "isAborting", true);
    removeStreamingId(key);
    void window.snow.abortResponseStream(ref.streamId);
  }, [updateSessionField, removeStreamingId]);

  const abortConversation = useCallback(
    (conversationId: string): void => {
      const ref = sessionsRefData.current.get(conversationId);
      if (ref?.streamId) {
        void window.snow.abortResponseStream(ref.streamId);
        ref.streamId = null;
      }
      if (ref) {
        ref.isSending = false;
      }
      updateSessionField(conversationId, "isStreaming", false);
      updateSessionField(conversationId, "isAborting", false);
      removeStreamingId(conversationId);
      // Clean up session state and incremental checkpoint storage.
      if (ref) {
        deleteCheckpoints(ref.checkpointIds);
      }
      sessionsRefData.current.delete(conversationId);
      setSessions((prev) => {
        const next = { ...prev };
        delete next[conversationId];
        return next;
      });
    },
    [updateSessionField, removeStreamingId]
  );

  const refreshConversations = useCallback((): void => {
    setConversationVersion((version) => version + 1);
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
        setUpsertedConversation({
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

  const clearDraftToRestore = useCallback((): void => {
    setDraftToRestore(null);
  }, []);

  const handleRollback = useCallback(
    (messageId: string): void => {
      const key = activeConversationIdRef.current ?? PENDING_SESSION_KEY;

      // Abort any in-flight stream before rolling back.
      const ref = sessionsRefData.current.get(key);
      if (ref?.streamId) {
        void window.snow.abortResponseStream(ref.streamId);
        ref.streamId = null;
      }
      if (ref) {
        ref.isSending = false;
      }
      updateSessionField(key, "isStreaming", false);
      updateSessionField(key, "isAborting", false);
      removeStreamingId(key);

      const session = sessionsRef.current[key];
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

      // Determine if this is the first user message — rolling back to it
      // means the entire conversation should be deleted.
      const hasUserMessageBefore = messages
        .slice(0, targetIndex)
        .some((m) => m.role === "user");
      const isFirstMessage = !hasUserMessageBefore;

      // Find the responseId of the first assistant message after the target.
      let responseId: string | undefined;
      for (let i = targetIndex + 1; i < messages.length; i++) {
        if (messages[i].role === "assistant" && messages[i].responseId) {
          responseId = messages[i].responseId;
          break;
        }
      }

      // Compute file changes for the confirmation dialog. This is async but
      // we set the preview state once the diff is ready.
      const computeAndPreview = async (): Promise<void> => {
        let changes: CheckpointFileChange[] = [];
        if (
          checkpointId &&
          directoryPath &&
          !directoryPath.startsWith("ssh://")
        ) {
          try {
            changes = await window.snow.listCheckpointChanges(
              checkpointId,
              directoryPath
            );
          } catch {
            // Best effort — show dialog without changes on error
          }
        }

        setRollbackPreview({
          messageId,
          messageContent,
          changes,
          checkpointId,
          workDir: directoryPath,
          convId,
          responseId,
          isFirstMessage,
        });
      };

      void computeAndPreview();
    },
    [directoryPath, updateSessionField, removeStreamingId]
  );

  const confirmRollback = useCallback((): void => {
    const preview = rollbackPreview;
    if (!preview) {
      return;
    }

    const key = activeConversationIdRef.current ?? PENDING_SESSION_KEY;
    const {
      messageId,
      messageContent,
      checkpointId,
      convId,
      responseId,
      isFirstMessage,
    } = preview;

    // Truncate UI state: remove the target message and everything after.
    updateSessionMessages(key, (currentMessages) => {
      const idx = currentMessages.findIndex((m) => m.id === messageId);
      if (idx === -1) {
        return currentMessages;
      }
      return currentMessages.slice(0, idx);
    });

    // Restore file-system checkpoint and then release every checkpoint at or
    // after the rollback target. Earlier checkpoints remain active.
    if (checkpointId && directoryPath && !directoryPath.startsWith("ssh://")) {
      const sessionRef = sessionsRefData.current.get(key);
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
      void window.snow
        .restoreCheckpoint(checkpointId, directoryPath)
        .then(() => {
          deleteCheckpoints(discardedCheckpointIds);
        })
        .catch(() => {
          // Keep the target checkpoint when restore fails so retry is possible.
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
    }

    if (isFirstMessage && convId) {
      // Rolling back to the first user message — delete the entire
      // conversation from the DB and clear the session.
      void window.snow
        .deleteConversation(convId)
        .then(() => {
          refreshConversations();
        })
        .catch(() => {
          // Best effort
        });
      sessionsRefData.current.delete(key);
      setSessions((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setActiveId(undefined);
    } else if (convId && responseId) {
      // Truncate DB messages from the exchange onward.
      void window.snow.truncateConversation(convId, responseId).catch(() => {
        // Best effort — DB truncation failure should not block the UI
      });
    }

    // Write the rolled-back message content back into the input box.
    setDraftToRestore(messageContent);
    setRollbackPreview(null);
  }, [
    rollbackPreview,
    directoryPath,
    updateSessionMessages,
    refreshConversations,
    setActiveId,
  ]);

  const cancelRollback = useCallback((): void => {
    setRollbackPreview(null);
  }, []);

  const activeKey = activeConversationId ?? PENDING_SESSION_KEY;
  const activeSession = sessions[activeKey];

  return {
    messages: activeSession?.messages ?? [],
    summary: activeSession?.summary ?? "",
    conversationVersion,
    upsertedConversation,
    activeConversationId,
    conversationDirectoryId: activeSession?.directoryId,
    tokenUsage: activeSession?.tokenUsage ?? null,
    forkedFromConversationId: activeSession?.forkedFromConversationId,
    forkMessageCount: activeSession?.forkMessageCount,
    streamingConversationIds,
    completedConversationIds,
    handleSendMessage,
    handleSelectConversation,
    handleNewChat,
    refreshConversations,
    isStreaming: activeSession?.isStreaming ?? false,
    isAborting: activeSession?.isAborting ?? false,
    handleAbort,
    abortConversation,
    handleForkConversation,
    draftToRestore,
    clearDraftToRestore,
    handleRollback,
    rollbackPreview,
    confirmRollback,
    cancelRollback,
  };
};
