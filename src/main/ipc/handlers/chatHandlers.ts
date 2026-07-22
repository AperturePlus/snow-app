import { ipcMain } from "electron";
import type {
  NativeBridge,
  ResponsesApiRequest,
  ResponsesApiStreamChunk,
} from "../../native/types";
import { snowLog } from "../../../utils/snowLogger";

const CHAT_CREATE_RESPONSE_CHUNK_CHANNEL = "chat:create-response:chunk";

const normalizeCreateResponseStreamId = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Create response stream ID is required");
  }

  return value.trim();
};

const normalizeResponsesApiRequest = (value: unknown): ResponsesApiRequest => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Responses API request payload must be an object");
  }

  const source = value as Partial<Record<keyof ResponsesApiRequest, unknown>>;
  const rawMessages = Array.isArray(source.messages) ? source.messages : [];
  const messages = rawMessages
    .map((item) => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) {
        return null;
      }

      const message = item as Partial<
        Record<keyof ResponsesApiRequest["messages"][number], unknown>
      >;
      const role =
        message.role === "assistant" ||
        message.role === "system" ||
        message.role === "developer" ||
        message.role === "tool"
          ? message.role
          : "user";
      const content =
        typeof message.content === "string" ? message.content : "";

      return {
        role,
        content,
      };
    })
    .filter((message): message is ResponsesApiRequest["messages"][number] =>
      Boolean(message && message.content.trim())
    );

  if (messages.length === 0) {
    throw new Error(
      "Responses API request requires at least one non-empty message"
    );
  }

  return {
    messages,
    model: typeof source.model === "string" ? source.model : undefined,
    conversationId:
      typeof source.conversationId === "string"
        ? source.conversationId
        : undefined,
    previousResponseId:
      typeof source.previousResponseId === "string"
        ? source.previousResponseId
        : undefined,
    directoryId:
      typeof source.directoryId === "string" ? source.directoryId : undefined,
    checkpointId:
      typeof source.checkpointId === "string" ? source.checkpointId : undefined,
    contextCompaction:
      typeof source.contextCompaction === "boolean"
        ? source.contextCompaction
        : undefined,
    subAgentToolsJson:
      typeof source.subAgentToolsJson === "string"
        ? source.subAgentToolsJson
        : undefined,
    subAgentConfigProfile:
      typeof source.subAgentConfigProfile === "string"
        ? source.subAgentConfigProfile
        : undefined,
    skipContext:
      typeof source.skipContext === "boolean" ? source.skipContext : undefined,
    planMode:
      typeof source.planMode === "boolean" ? source.planMode : undefined,
  };
};

export const registerChatHandlers = (native: NativeBridge): void => {
  ipcMain.handle(
    "chat:create-response-stream",
    async (event, request: unknown, streamId: unknown) => {
      const normalizedRequest = normalizeResponsesApiRequest(request);
      const normalizedStreamId = normalizeCreateResponseStreamId(streamId);

      try {
        return await native.createResponseStream(
          normalizedRequest,
          (chunk: ResponsesApiStreamChunk) => {
            if (event.sender.isDestroyed()) {
              return;
            }

            event.sender.send(CHAT_CREATE_RESPONSE_CHUNK_CHANNEL, {
              streamId: normalizedStreamId,
              chunk,
            });
          },
          normalizedStreamId
        );
      } catch (error) {
        snowLog.error({
          module: "ipc/chat",
          func: "create-response-stream",
          message: "Response stream failed",
          context: `model=${normalizedRequest.model ?? "default"}`,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }
  );

  ipcMain.handle("chat:abort-response-stream", (_event, streamId: unknown) => {
    const normalizedStreamId = normalizeCreateResponseStreamId(streamId);
    snowLog.warn({
      module: "ipc/chat",
      func: "abort-response-stream",
      message: "Response stream aborted",
      context: `streamId=${normalizedStreamId}`,
    });
    return native.abortResponseStream(normalizedStreamId);
  });
};
