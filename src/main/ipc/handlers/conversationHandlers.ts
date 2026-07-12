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
    "chat-conversations:append-tool-message",
    async (_event, conversationId: unknown, content: unknown) => {
      if (typeof conversationId !== "string" || !conversationId.trim()) {
        throw new Error("Conversation ID is required to append a tool message");
      }
      if (typeof content !== "string" || !content.trim()) {
        throw new Error("Tool message content is required");
      }

      await native.appendToolMessage(conversationId.trim(), content);
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
    "chat-conversations:list-messages-paginated",
    (
      _event,
      conversationId: unknown,
      beforeMessageId: unknown,
      limit: unknown
    ) => {
      if (typeof conversationId !== "string" || !conversationId.trim()) {
        throw new Error("Conversation ID is required to list chat messages");
      }

      const safeBeforeMessageId =
        typeof beforeMessageId === "string" ? beforeMessageId.trim() : "";
      const safeLimit =
        typeof limit === "number" && limit > 0 ? Math.floor(limit) : 10;

      return native.listChatMessagesPaginated(
        conversationId.trim(),
        safeBeforeMessageId,
        safeLimit
      );
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
    "chat-conversations:truncate",
    async (_event, conversationId: unknown, responseId: unknown) => {
      if (typeof conversationId !== "string" || !conversationId.trim()) {
        throw new Error("Conversation ID is required to truncate");
      }
      if (typeof responseId !== "string" || !responseId.trim()) {
        throw new Error("Response ID is required to truncate conversation");
      }

      await native.truncateConversationFromResponse(
        conversationId.trim(),
        responseId.trim()
      );
    }
  );
  ipcMain.handle(
    "chat-conversations:count-todos",
    async (_event, sessionId: unknown, responseId: unknown) => {
      if (typeof sessionId !== "string" || !sessionId.trim()) {
        throw new Error("Session ID is required to count todos");
      }
      if (typeof responseId !== "string" || !responseId.trim()) {
        throw new Error("Response ID is required to count todos");
      }
      return native.listTodosForRollback(sessionId.trim(), responseId.trim());
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
};
