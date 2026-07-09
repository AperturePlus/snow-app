import { ipcMain } from "electron";
import type { NativeBridge } from "../../native/types";

export const registerConversationHandlers = (native: NativeBridge): void => {
  ipcMain.handle("chat-conversations:list", (_event, directoryId: unknown) => {
    if (typeof directoryId !== "string" || !directoryId.trim()) {
      throw new Error("Directory ID is required to list chat conversations");
    }

    return native.listChatConversations(directoryId.trim());
  });
  ipcMain.handle(
    "chat-conversations:list-paginated",
    (_event, directoryId: unknown, limit: unknown, offset: unknown) => {
      if (typeof directoryId !== "string" || !directoryId.trim()) {
        throw new Error("Directory ID is required to list chat conversations");
      }

      const safeLimit =
        typeof limit === "number" && limit > 0 ? Math.floor(limit) : 20;
      const safeOffset =
        typeof offset === "number" && offset > 0 ? Math.floor(offset) : 0;

      return native.listChatConversationsPaginated(
        directoryId.trim(),
        safeLimit,
        safeOffset
      );
    }
  );
  ipcMain.handle(
    "chat-conversations:list-pinned",
    (_event, directoryId: unknown) => {
      if (typeof directoryId !== "string" || !directoryId.trim()) {
        throw new Error(
          "Directory ID is required to list pinned conversations"
        );
      }

      return native.listPinnedConversations(directoryId.trim());
    }
  );
  ipcMain.handle(
    "chat-conversations:get",
    (_event, conversationId: unknown) => {
      if (typeof conversationId !== "string" || !conversationId.trim()) {
        throw new Error("Conversation ID is required to get conversation");
      }
      return native.getChatConversation(conversationId.trim());
    }
  );
  ipcMain.handle(
    "chat-conversations:generate-summary",
    async (_event, conversationId: unknown) => {
      if (typeof conversationId !== "string" || !conversationId.trim()) {
        throw new Error("Conversation ID is required to generate summary");
      }
      return native.generateConversationSummary(conversationId.trim());
    }
  );
  ipcMain.handle(
    "chat-conversations:list-messages",
    (_event, conversationId: unknown) => {
      if (typeof conversationId !== "string" || !conversationId.trim()) {
        throw new Error("Conversation ID is required to list chat messages");
      }

      return native.listChatMessages(conversationId.trim());
    }
  );
  ipcMain.handle(
    "chat-conversations:fork",
    async (_event, sourceConversationId: unknown, upToResponseId: unknown) => {
      if (
        typeof sourceConversationId !== "string" ||
        !sourceConversationId.trim()
      ) {
        throw new Error("Source conversation ID is required to fork");
      }

      const responseId =
        typeof upToResponseId === "string" ? upToResponseId.trim() : "";

      return native.forkConversation(sourceConversationId.trim(), responseId);
    }
  );
  ipcMain.handle(
    "chat-conversations:update-status",
    async (_event, conversationId: unknown, status: unknown) => {
      if (typeof conversationId !== "string" || !conversationId.trim()) {
        throw new Error("Conversation ID is required to update status");
      }
      if (typeof status !== "string" || !status.trim()) {
        throw new Error("Status is required to update conversation status");
      }

      await native.updateConversationStatus(
        conversationId.trim(),
        status.trim()
      );
    }
  );
  ipcMain.handle(
    "chat-conversations:rename",
    async (_event, conversationId: unknown, title: unknown) => {
      if (typeof conversationId !== "string" || !conversationId.trim()) {
        throw new Error("Conversation ID is required to rename");
      }
      if (typeof title !== "string" || !title.trim()) {
        throw new Error("Title is required to rename conversation");
      }

      await native.renameConversation(conversationId.trim(), title.trim());
    }
  );
  ipcMain.handle(
    "chat-conversations:delete",
    async (_event, conversationId: unknown) => {
      if (typeof conversationId !== "string" || !conversationId.trim()) {
        throw new Error("Conversation ID is required to delete");
      }

      await native.deleteConversation(conversationId.trim());
    }
  );

  ipcMain.handle(
    "chat-conversations:truncate-from-user-index",
    async (_event, conversationId: unknown, userMessageIndex: unknown) => {
      if (typeof conversationId !== "string" || !conversationId.trim()) {
        throw new Error(
          "Conversation ID is required to truncate chat messages"
        );
      }
      if (
        typeof userMessageIndex !== "number" ||
        !Number.isFinite(userMessageIndex)
      ) {
        throw new Error("User message index is required");
      }

      await native.truncateChatMessagesFromUserIndex(
        conversationId.trim(),
        Math.floor(userMessageIndex)
      );
    }
  );

  ipcMain.handle(
    "checkpoint:begin",
    async (_event, conversationId: unknown, messageId: unknown) => {
      if (typeof conversationId !== "string" || !conversationId.trim()) {
        throw new Error("Conversation ID is required to begin checkpoint");
      }
      if (typeof messageId !== "string" || !messageId.trim()) {
        throw new Error("Message ID is required to begin checkpoint");
      }

      await native.beginCheckpoint(conversationId.trim(), messageId.trim());
    }
  );

  ipcMain.handle(
    "checkpoint:migrate",
    async (_event, oldConversationId: unknown, newConversationId: unknown) => {
      if (typeof oldConversationId !== "string" || !oldConversationId.trim()) {
        throw new Error("Old conversation ID is required to migrate checkpoint");
      }
      if (typeof newConversationId !== "string" || !newConversationId.trim()) {
        throw new Error("New conversation ID is required to migrate checkpoint");
      }

      await native.migrateCheckpoint(
        oldConversationId.trim(),
        newConversationId.trim()
      );
    }
  );

  ipcMain.handle(
    "checkpoint:restore",
    async (_event, conversationId: unknown, messageId: unknown) => {
      if (typeof conversationId !== "string" || !conversationId.trim()) {
        throw new Error("Conversation ID is required to restore checkpoint");
      }
      if (typeof messageId !== "string" || !messageId.trim()) {
        throw new Error("Message ID is required to restore checkpoint");
      }

      return native.restoreCheckpoint(conversationId.trim(), messageId.trim());
    }
  );
};
