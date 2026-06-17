import { useCallback, useRef, useState } from "react";
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
  handleSendMessage: (message: string, options: ChatInputSendOptions) => void;
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

const STREAMING_PLACEHOLDER = "正在思考...";

export const useChatConversation = (): UseChatConversationResult => {
  const [messages, setMessages] = useState<ChatConversationMessage[]>([]);
  const conversationIdRef = useRef<string | undefined>(undefined);
  const isSendingRef = useRef(false);

  const handleSendMessage = useCallback(
    (message: string, options: ChatInputSendOptions) => {
      const trimmed = message.trim();
      if (!trimmed || isSendingRef.current) {
        return;
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
        content: STREAMING_PLACEHOLDER,
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
          },
          (chunk) => {
            setMessages((currentMessages) =>
              currentMessages.map((currentMessage) => {
                if (currentMessage.id !== assistantMessageId) {
                  return currentMessage;
                }

                const existingContent =
                  currentMessage.content === STREAMING_PLACEHOLDER
                    ? ""
                    : currentMessage.content;
                const nextContent =
                  chunk.content || `${existingContent}${chunk.contentDelta}`;
                const nextThinking =
                  chunk.thinking ||
                  `${currentMessage.thinking ?? ""}${chunk.thinkingDelta}`;

                return {
                  ...currentMessage,
                  content: nextContent || STREAMING_PLACEHOLDER,
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
          }

          setMessages((currentMessages) =>
            currentMessages.map((currentMessage) => {
              if (currentMessage.id !== assistantMessageId) {
                return currentMessage;
              }

              const streamedContent =
                currentMessage.content === STREAMING_PLACEHOLDER
                  ? ""
                  : currentMessage.content;

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
    []
  );

  return { messages, handleSendMessage };
};
