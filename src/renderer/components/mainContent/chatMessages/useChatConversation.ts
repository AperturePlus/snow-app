import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatInputSendOptions } from "../chatInput/types";
import type { ChatConversationRecord, TokenUsage } from "../../../../preload";

export type ToolCallInfo = {
  name: string;
  arguments: string;
  callId?: string;
  status: "pending" | "running" | "completed" | "error";
  result?: string;
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
};

type UpsertedConversation = {
  record: ChatConversationRecord;
  timestamp: number;
};

type UseChatConversationResult = {
  messages: ChatConversationMessage[];
  summary: string;
  conversationVersion: number;
  upsertedConversation: UpsertedConversation | null;
  activeConversationId: string | undefined;
  tokenUsage: TokenUsage | null;
  handleSendMessage: (message: string, options: ChatInputSendOptions) => void;
  handleSelectConversation: (
    conversationId: string,
    title?: string,
    tokenUsage?: TokenUsage | null
  ) => void;
  handleNewChat: () => void;
  refreshConversations: () => void;
  isStreaming: boolean;
  isAborting: boolean;
  handleAbort: () => void;
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

const normalizeToolCallName = (tc: Record<string, unknown>): string => {
  const directName = typeof tc.name === "string" ? tc.name : "";
  if (directName) {
    return directName;
  }
  const func = tc.function;
  if (typeof func === "object" && func !== null && !Array.isArray(func)) {
    const funcRecord = func as Record<string, unknown>;
    return typeof funcRecord.name === "string" ? funcRecord.name : "";
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

export const useChatConversation = (
  directoryId?: string
): UseChatConversationResult => {
  const [messages, setMessages] = useState<ChatConversationMessage[]>([]);
  const [summary, setSummary] = useState("");
  const [conversationVersion, setConversationVersion] = useState(0);
  const [upsertedConversation, setUpsertedConversation] =
    useState<UpsertedConversation | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<
    string | undefined
  >(undefined);
  const conversationIdRef = useRef<string | undefined>(undefined);
  const isSendingRef = useRef(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isAborting, setIsAborting] = useState(false);
  const activeStreamIdRef = useRef<string | null>(null);
  const [tokenUsage, setTokenUsage] = useState<TokenUsage | null>(null);

  useEffect(() => {
    setMessages([]);
    setSummary("");
    setConversationVersion(0);
    setActiveConversationId(undefined);
    setTokenUsage(null);
    conversationIdRef.current = undefined;
  }, [directoryId]);

  const handleSendMessage = useCallback(
    (message: string, options: ChatInputSendOptions) => {
      const trimmed = message.trim();
      if (!trimmed || isSendingRef.current) {
        return;
      }

      const isFirstMessage = conversationIdRef.current === undefined;

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
      const conversationId = conversationIdRef.current;

      isSendingRef.current = true;
      setIsStreaming(true);
      setMessages((currentMessages) => [
        ...currentMessages,
        userMessage,
        pendingAssistantMessage,
      ]);

      const MAX_TOOL_ITERATIONS = 10;
      let iteration = 0;

      const runAgentLoop = async (
        currentAssistantMessageId: string,
        requestMessages: {
          role: "user" | "assistant" | "system" | "developer" | "tool";
          content: string;
        }[],
        currentConversationId: string | undefined
      ): Promise<void> => {
        const response = await window.snow.createResponseStream(
          {
            messages: requestMessages,
            model: options.model,
            conversationId: currentConversationId,
            directoryId,
          },
          (chunk) => {
            setMessages((currentMessages) =>
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
            activeStreamIdRef.current = streamId;
          }
        );

        activeStreamIdRef.current = null;

        if (response.conversationId) {
          conversationIdRef.current = response.conversationId;
          setActiveConversationId(response.conversationId);
        }

        if (response.tokenUsage) {
          setTokenUsage(response.tokenUsage);
        }

        // Parse tool calls from response
        const toolCalls = parseToolCalls(response.toolCallsJson);

        // Update assistant message with final content
        setMessages((currentMessages) =>
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
              toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
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

        // Execute tool calls and collect results
        const toolResults: string[] = [];
        for (const toolCall of toolCalls) {
          // Update tool call status to running
          setMessages((currentMessages) =>
            currentMessages.map((currentMessage) => {
              if (currentMessage.id !== currentAssistantMessageId) {
                return currentMessage;
              }

              return {
                ...currentMessage,
                toolCalls: currentMessage.toolCalls?.map((tc) =>
                  tc.name === toolCall.name && tc.status === "pending"
                    ? { ...tc, status: "running" as const }
                    : tc
                ),
              };
            })
          );

          let result: string;
          try {
            result = await window.snow.callMcpTool(
              toolCall.name,
              toolCall.arguments
            );
          } catch (err) {
            result = JSON.stringify({ error: getErrorMessage(err) });
          }

          // Update tool call status to completed
          setMessages((currentMessages) =>
            currentMessages.map((currentMessage) => {
              if (currentMessage.id !== currentAssistantMessageId) {
                return currentMessage;
              }

              return {
                ...currentMessage,
                toolCalls: currentMessage.toolCalls?.map((tc) =>
                  tc.name === toolCall.name && tc.status === "running"
                    ? { ...tc, status: "completed" as const, result }
                    : tc
                ),
              };
            })
          );

          toolResults.push(`[Tool: ${toolCall.name}]\n${result}`);
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

        setMessages((currentMessages) => [
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

        setMessages((currentMessages) => [
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

      void runAgentLoop(
        assistantMessageId,
        [{ role: "user", content: trimmed }],
        conversationId
      )
        .catch((error: unknown) => {
          setIsStreaming(false);
          activeStreamIdRef.current = null;
          setMessages((currentMessages) =>
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
          isSendingRef.current = false;
          setIsStreaming(false);
          setIsAborting(false);

          // First message: immediately upsert the new conversation into
          // the list without waiting for the summary.
          if (isFirstMessage && conversationIdRef.current) {
            const currentId = conversationIdRef.current;

            void window.snow
              .getChatConversation(currentId)
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

            // Generate summary asynchronously, then upsert again to
            // update the conversation title.
            void window.snow
              .generateConversationSummary(currentId)
              .then((generatedSummary) => {
                if (generatedSummary) {
                  setSummary(generatedSummary);
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
    [directoryId]
  );

  const handleSelectConversation = useCallback(
    async (
      conversationId: string,
      title?: string,
      conversationTokenUsage?: TokenUsage | null
    ): Promise<void> => {
      const trimmedId = conversationId.trim();
      if (!trimmedId || isSendingRef.current) {
        return;
      }
      if (trimmedId === conversationIdRef.current) {
        return;
      }

      const nextTitle = title?.trim() ?? "";

      try {
        const records = await window.snow.listChatMessages(trimmedId);

        // Build a lookup: toolName -> result content from tool-role messages.
        // Tool messages store content as "[Tool: name]\nresult" (joined by \n\n
        // when multiple tools share one message).
        const toolResultMap = new Map<string, string>();
        for (const record of records) {
          if (record.role === "tool" && record.content) {
            for (const segment of record.content.split("\n\n")) {
              const match = segment.match(/^\[Tool:\s*(.+?)\]\n([\s\S]*)$/);
              if (match) {
                toolResultMap.set(match[1], match[2]);
              }
            }
          }
        }

        const loadedMessages: ChatConversationMessage[] = records
          .filter((record) => record.role !== "tool")
          .map((record) => {
            const toolCalls = parseToolCalls(record.toolCallsJson).map((tc) => {
              const result = toolResultMap.get(tc.name);
              return {
                ...tc,
                status: "completed" as const,
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
              model: record.model || undefined,
              toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            };
          });

        conversationIdRef.current = trimmedId;
        setActiveConversationId(trimmedId);
        setMessages(loadedMessages);
        setSummary(nextTitle);
        setTokenUsage(conversationTokenUsage ?? null);
      } catch {
        // 加载历史消息失败时静默处理，不阻断交互
      }
    },
    []
  );

  const handleNewChat = useCallback(() => {
    setMessages([]);
    setSummary("");
    setActiveConversationId(undefined);
    setTokenUsage(null);
    conversationIdRef.current = undefined;
  }, []);

  const handleAbort = useCallback(() => {
    const streamId = activeStreamIdRef.current;
    if (!streamId) {
      return;
    }
    setIsStreaming(false);
    setIsAborting(true);
    void window.snow.abortResponseStream(streamId);
  }, []);

  const refreshConversations = useCallback(() => {
    setConversationVersion((version) => version + 1);
  }, []);

  return {
    messages,
    summary,
    conversationVersion,
    upsertedConversation,
    activeConversationId,
    tokenUsage,
    handleSendMessage,
    handleSelectConversation,
    handleNewChat,
    refreshConversations,
    isStreaming,
    isAborting,
    handleAbort,
  };
};
