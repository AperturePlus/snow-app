import { ipcMain } from "electron";
import type { NativeBridge } from "../../native/types";
import { snowLog } from "../../../utils/snowLogger";

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

      snowLog.info({
        module: "ipc/conversation",
        func: "fork",
        message: "Conversation forked",
        context: `source=${sourceConversationId.trim()} response=${
          responseId || "head"
        }`,
      });
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

      snowLog.info({
        module: "ipc/conversation",
        func: "truncate",
        message: "Conversation truncated",
        context: `conversation=${conversationId.trim()} response=${responseId.trim()}`,
      });
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

      snowLog.warn({
        module: "ipc/conversation",
        func: "delete",
        message: "Conversation deleted",
        context: `conversation=${conversationId.trim()}`,
      });
      await native.deleteConversation(conversationId.trim());
    }
  );
  ipcMain.handle(
    "chat-conversations:list-sub-agent",
    (_event, parentConversationId: unknown) => {
      if (
        typeof parentConversationId !== "string" ||
        !parentConversationId.trim()
      ) {
        throw new Error(
          "Parent conversation ID is required to list sub-agent conversations"
        );
      }

      return native.listSubAgentConversations(parentConversationId.trim());
    }
  );
  ipcMain.handle(
    "chat-conversations:create-sub-agent-session",
    async (
      _event,
      conversationId: unknown,
      parentConversationId: unknown,
      agentId: unknown,
      agentName: unknown,
      directoryId: unknown,
      model: unknown,
      title: unknown
    ) => {
      if (typeof conversationId !== "string" || !conversationId.trim()) {
        throw new Error(
          "Conversation ID is required to create sub-agent session"
        );
      }
      if (
        typeof parentConversationId !== "string" ||
        !parentConversationId.trim()
      ) {
        throw new Error(
          "Parent conversation ID is required to create sub-agent session"
        );
      }
      if (typeof agentId !== "string" || !agentId.trim()) {
        throw new Error("Agent ID is required to create sub-agent session");
      }
      if (typeof agentName !== "string" || !agentName.trim()) {
        throw new Error("Agent name is required to create sub-agent session");
      }
      if (typeof directoryId !== "string") {
        throw new Error("Directory ID is required to create sub-agent session");
      }
      if (typeof model !== "string") {
        throw new Error("Model is required to create sub-agent session");
      }
      if (typeof title !== "string" || !title.trim()) {
        throw new Error("Title is required to create sub-agent session");
      }

      snowLog.info({
        module: "ipc/conversation",
        func: "create-sub-agent-session",
        message: "Sub-agent session created",
        context: `agent=${agentName.trim()} conversation=${conversationId.trim()} parent=${parentConversationId.trim()}`,
      });
      await native.createSubAgentSession(
        conversationId.trim(),
        parentConversationId.trim(),
        agentId.trim(),
        agentName.trim(),
        directoryId.trim(),
        model.trim(),
        title.trim()
      );
    }
  );
  ipcMain.handle(
    "chat-conversations:update-sub-agent-status",
    async (
      _event,
      conversationId: unknown,
      runStatus: unknown,
      errorMessage: unknown
    ) => {
      if (typeof conversationId !== "string" || !conversationId.trim()) {
        throw new Error(
          "Conversation ID is required to update sub-agent session status"
        );
      }
      if (typeof runStatus !== "string" || !runStatus.trim()) {
        throw new Error(
          "Run status is required to update sub-agent session status"
        );
      }

      const normalizedStatus = runStatus.trim();
      const normalizedError =
        typeof errorMessage === "string" ? errorMessage : "";
      if (normalizedStatus === "failed" || normalizedError) {
        snowLog.error({
          module: "ipc/conversation",
          func: "update-sub-agent-status",
          message: "Sub-agent session failed",
          context: `conversation=${conversationId.trim()} status=${normalizedStatus}`,
          error: normalizedError,
        });
      } else {
        snowLog.info({
          module: "ipc/conversation",
          func: "update-sub-agent-status",
          message: "Sub-agent session status updated",
          context: `conversation=${conversationId.trim()} status=${normalizedStatus}`,
        });
      }
      await native.updateSubAgentSessionStatus(
        conversationId.trim(),
        normalizedStatus,
        normalizedError
      );
    }
  );
  ipcMain.handle("sub-agent-configs:get", async (_event, agentId: unknown) => {
    if (typeof agentId !== "string" || !agentId.trim()) {
      throw new Error("Agent ID is required to get sub-agent config");
    }

    return native.getSubAgentConfig(agentId.trim());
  });
};
