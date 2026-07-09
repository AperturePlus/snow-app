import { ipcRenderer } from "electron";
import type {
  ChatConversationPage,
  ChatConversationRecord,
  ChatMessageRecord,
} from "../types";

export const conversationApi = {
  listChatConversations: (
    directoryId: string
  ): Promise<ChatConversationRecord[]> =>
    ipcRenderer.invoke("chat-conversations:list", directoryId),
  listChatConversationsPaginated: (
    directoryId: string,
    limit: number,
    offset: number
  ): Promise<ChatConversationPage> =>
    ipcRenderer.invoke(
      "chat-conversations:list-paginated",
      directoryId,
      limit,
      offset
    ),
  listPinnedConversations: (
    directoryId: string
  ): Promise<ChatConversationRecord[]> =>
    ipcRenderer.invoke("chat-conversations:list-pinned", directoryId),
  getChatConversation: (
    conversationId: string
  ): Promise<ChatConversationRecord | null> =>
    ipcRenderer.invoke("chat-conversations:get", conversationId),
  updateConversationStatus: (
    conversationId: string,
    status: string
  ): Promise<void> =>
    ipcRenderer.invoke(
      "chat-conversations:update-status",
      conversationId,
      status
    ),
  renameConversation: (conversationId: string, title: string): Promise<void> =>
    ipcRenderer.invoke("chat-conversations:rename", conversationId, title),
  deleteConversation: (conversationId: string): Promise<void> =>
    ipcRenderer.invoke("chat-conversations:delete", conversationId),
  listChatMessages: (conversationId: string): Promise<ChatMessageRecord[]> =>
    ipcRenderer.invoke("chat-conversations:list-messages", conversationId),
  forkConversation: (
    sourceConversationId: string,
    upToResponseId: string
  ): Promise<ChatConversationRecord> =>
    ipcRenderer.invoke(
      "chat-conversations:fork",
      sourceConversationId,
      upToResponseId
    ),
  generateConversationSummary: (conversationId: string): Promise<string> =>
    ipcRenderer.invoke("chat-conversations:generate-summary", conversationId),
};
