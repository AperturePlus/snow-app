import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatInputSendOptions } from "../chatInput/types";

export type ChatConversationMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  thinking?: string;
  timestamp: string;
  status?: "sending" | "sent" | "error";
  responseId?: string;
  model?: string;
};

type UseChatConversationResult = {
  messages: ChatConversationMessage[];
  summary: string;
  conversationVersion: number;
  activeConversationId: string | undefined;
  handleSendMessage: (message: string, options: ChatInputSendOptions) => void;
  handleSelectConversation: (conversationId: string, title?: string) => void;
  handleNewChat: () => void;
  refreshConversations: () => void;
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

export const useChatConversation = (
  directoryId?: string
): UseChatConversationResult => {
  const [messages, setMessages] = useState<ChatConversationMessage[]>([]);
  const [summary, setSummary] = useState("");
  const [conversationVersion, setConversationVersion] = useState(0);
  const [activeConversationId, setActiveConversationId] = useState<
    string | undefined
  >(undefined);
  const conversationIdRef = useRef<string | undefined>(undefined);
  const isSendingRef = useRef(false);

  useEffect(() => {
    setMessages([]);
    setSummary("");
    setConversationVersion(0);
    setActiveConversationId(undefined);
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
      setMessages((currentMessages) => [
        ...currentMessages,
        userMessage,
        pendingAssistantMessage,
      ]);

      void window.snow
        .createResponseStream(
          {
            messages: [{ role: "user", content: trimmed }],
            model: options.model,
            conversationId,
            directoryId,
          },
          (chunk) => {
            setMessages((currentMessages) =>
              currentMessages.map((currentMessage) => {
                if (currentMessage.id !== assistantMessageId) {
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
          }
        )
        .then((response) => {
          if (response.conversationId) {
            conversationIdRef.current = response.conversationId;
            setActiveConversationId(response.conversationId);
          }

          setMessages((currentMessages) =>
            currentMessages.map((currentMessage) => {
              if (currentMessage.id !== assistantMessageId) {
                return currentMessage;
              }

              const streamedContent = currentMessage.content;

              return {
                ...currentMessage,
                content: response.content || streamedContent || "（空响应）",
                thinking:
                  response.thinking || currentMessage.thinking || undefined,
                timestamp: formatMessageTime(),
                status: "sent",
                responseId: response.id,
                model: response.model || options.model,
              };
            })
          );

          if (isFirstMessage && response.conversationId) {
            void window.snow
              .generateConversationSummary(response.conversationId)
              .then((generatedSummary) => {
                if (generatedSummary) {
                  setSummary(generatedSummary);
                  setConversationVersion((version) => version + 1);
                }
              })
              .catch(() => {
                // Summary generation failure should not block the conversation
              });
          }
        })
        .catch((error: unknown) => {
          setMessages((currentMessages) =>
            currentMessages.map((currentMessage) =>
              currentMessage.id === assistantMessageId
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
        });
    },
    [directoryId]
  );

  const handleSelectConversation = useCallback(
    async (conversationId: string, title?: string): Promise<void> => {
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
        const loadedMessages: ChatConversationMessage[] = records.map(
          (record) => ({
            id: record.id,
            role: record.role === "user" ? "user" : "assistant",
            content: record.content,
            thinking: record.thinking || undefined,
            timestamp: record.createdAt,
            status: record.status === "error" ? "error" : "sent",
            responseId: record.responseId || undefined,
            model: record.model || undefined,
          })
        );

        conversationIdRef.current = trimmedId;
        setActiveConversationId(trimmedId);
        setMessages(loadedMessages);
        setSummary(nextTitle);
      } catch {
        // 加载历史消息失败时静默处理，不阻断交互
      }
    },
    []
  );

  const handleNewChat = useCallback(() => {
    setMessages([]);
    setSummary("");
    setConversationVersion(0);
    setActiveConversationId(undefined);
    conversationIdRef.current = undefined;
  }, []);

  const refreshConversations = useCallback(() => {
    setConversationVersion((version) => version + 1);
  }, []);

  return {
    messages,
    summary,
    conversationVersion,
    activeConversationId,
    handleSendMessage,
    handleSelectConversation,
    handleNewChat,
    refreshConversations,
  };
};
