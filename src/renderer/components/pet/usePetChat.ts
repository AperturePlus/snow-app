/**
 * 宠物聊天的内存态：消息列表、输入草稿、工具状态与流式控制。
 *
 * 状态挂在宠物窗口根组件上（而不是聊天面板内部），这样「关闭聊天变回宠物」
 * 再双击展开时对话仍然保留；消息永远不会被写入任何会话数据。
 *
 * 输入框是 contentEditable（需要支持图片 chip），因此草稿以「序列化内容」
 * （含 @@image:...@@ 等标签）的形式同步到状态里，仅用于空态判断与占位符；
 * 真正发送的内容由面板在发送时从 DOM 读取后显式传入 send(content)。
 */
import { useEffect, useRef, useState } from "react";
import type {
  PetChatLabels,
  PetChatMessage,
} from "../../../preload/types/pets";
import { summarizeContentAsPlainText } from "../mainContent/chatInput/fileTagUtils";

export type PetChatController = {
  messages: PetChatMessage[];
  /** 输入区当前的序列化内容（含标签），仅用于空态判断 */
  draft: string;
  setDraft: (value: string) => void;
  isStreaming: boolean;
  /** 当前正在执行的工具状态行（联网搜索 / 文件搜索 / 文件阅读），无则 null */
  toolActivity: PetChatToolActivity | null;
  /** content 为序列化后的编辑区内容（图片以 @@image:...@@ 承载） */
  send: (content: string) => void;
  stop: () => void;
  /** 新建对话：中止在途请求并清空消息与草稿 */
  reset: () => void;
};

/** 宠物聊天的工具状态行（驱动「正在搜索…」提示）。 */
export type PetChatToolActivity = {
  name: string;
  detail: string;
  status: "running" | "completed" | "error";
};

const createRequestId = (): string =>
  `pet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export function usePetChat(labels: PetChatLabels | null): PetChatController {
  const [messages, setMessages] = useState<PetChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [toolActivity, setToolActivity] = useState<PetChatToolActivity | null>(
    null,
  );
  const labelsRef = useRef(labels);
  useEffect(() => {
    labelsRef.current = labels;
  }, [labels]);

  // 流式增量按 requestId 归属到对应的助手气泡（id = `${requestId}-a`）。
  useEffect(() => {
    const bridge = window.petBridge;
    if (!bridge) {
      return;
    }
    return bridge.onChatChunk(({ requestId, contentDelta }) => {
      setMessages((previous) =>
        previous.map((message) =>
          message.id === `${requestId}-a`
            ? { ...message, content: message.content + contentDelta }
            : message,
        ),
      );
    });
  }, []);

  // 工具活动状态行：仅保留最新一次调用的状态（宠物窗口极小，不堆叠历史）。
  useEffect(() => {
    const bridge = window.petBridge;
    if (!bridge) {
      return;
    }
    return bridge.onChatTool((payload) => {
      setToolActivity({
        name: payload.name,
        detail: payload.detail,
        status: payload.status,
      });
    });
  }, []);

  const isStreaming = activeRequestId !== null;

  const send = (content: string): void => {
    const text = content.trim();
    const bridge = window.petBridge;
    if (!text || isStreaming || !bridge) {
      return;
    }

    const requestId = createRequestId();
    const assistantId = `${requestId}-a`;
    setMessages((previous) => [
      ...previous,
      {
        id: `${requestId}-u`,
        role: "user",
        content: summarizeContentAsPlainText(text),
        status: "done",
      },
      { id: assistantId, role: "assistant", content: "", status: "streaming" },
    ]);
    setDraft("");
    setActiveRequestId(requestId);
    setToolActivity(null);

    bridge
      .sendChat(requestId, text)
      .then((result) => {
        setMessages((previous) =>
          previous.map((message) => {
            if (message.id !== assistantId) {
              return message;
            }
            // 流式增量可能已到达；仅在为空时用最终结果兜底。
            const finalContent = message.content || result.content;
            return {
              ...message,
              content: finalContent,
              status: finalContent ? "done" : "error",
            };
          }),
        );
      })
      .catch(() => {
        setMessages((previous) =>
          previous.map((message) =>
            message.id === assistantId
              ? {
                  ...message,
                  content: message.content || labelsRef.current?.error || "",
                  status: "error",
                }
              : message,
          ),
        );
      })
      .finally(() => {
        setActiveRequestId(null);
        setToolActivity(null);
      });
  };

  const stop = (): void => {
    if (activeRequestId) {
      void window.petBridge?.abortChat(activeRequestId);
    }
  };

  const reset = (): void => {
    if (activeRequestId) {
      void window.petBridge?.abortChat(activeRequestId);
    }
    setActiveRequestId(null);
    setMessages([]);
    setDraft("");
    setToolActivity(null);
  };

  return {
    messages,
    draft,
    setDraft,
    isStreaming,
    toolActivity,
    send,
    stop,
    reset,
  };
}
