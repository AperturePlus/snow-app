import type {
  ChatConversationMessage,
  ToolCallInfo,
} from "./conversationTypes";
import type { ChatMessageRecord } from "../../../../../preload";

export const deleteCheckpoints = (checkpointIds: string[]): void => {
  for (const checkpointId of checkpointIds) {
    void window.snow.deleteCheckpoint(checkpointId).catch(() => {
      // Checkpoint cleanup is best effort.
    });
  }
};

export const formatMessageTime = (): string =>
  new Date().toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });

export const createMessageId = (
  role: ChatConversationMessage["role"]
): string => `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "AI 响应失败，请稍后重试。";

type McpImageContentBlock = {
  type: "image";
  data: string;
  mimeType: string;
};

const isMcpImageContentBlock = (
  value: unknown
): value is McpImageContentBlock => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const block = value as Record<string, unknown>;
  return (
    block.type === "image" &&
    typeof block.data === "string" &&
    block.data.length > 0 &&
    typeof block.mimeType === "string" &&
    block.mimeType.startsWith("image/")
  );
};

export const formatMcpToolResultForModel = (result: string): string => {
  try {
    const parsed = JSON.parse(result) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return result;
    }
    const record = parsed as Record<string, unknown>;
    if (!Array.isArray(record.content)) {
      return result;
    }

    const images = record.content.filter(isMcpImageContentBlock);
    if (images.length === 0) {
      return result;
    }
    const sanitizedContent = record.content.map((block) =>
      isMcpImageContentBlock(block)
        ? {
            type: "image",
            mimeType: block.mimeType,
            data: "[attached as multimodal image]",
          }
        : block
    );
    const imageTags = images.map(
      (image) => `@@image:data:${image.mimeType};base64,${image.data}@@`
    );
    return `${JSON.stringify({
      ...record,
      content: sanitizedContent,
    })}\n${imageTags.join("\n")}`;
  } catch {
    return result;
  }
};

export const normalizeToolCallArguments = (args: unknown): string => {
  if (typeof args === "string") {
    return args;
  }
  if (typeof args === "object" && args !== null) {
    return JSON.stringify(args);
  }
  return "{}";
};

export const isUserQuestionCancellationResult = (
  resultJson: string
): boolean => {
  try {
    const parsed: unknown = JSON.parse(resultJson);
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      (parsed as Record<string, unknown>).cancelled === true
    );
  } catch {
    return false;
  }
};

export const isValidToolName = (name: string): boolean => {
  // Valid format: {server_id}-{tool_name}, must contain at least one `-`
  // and have non-empty parts on both sides of the first `-`.
  const dashIndex = name.indexOf("-");
  if (dashIndex <= 0) {
    return false;
  }
  const toolName = name.slice(dashIndex + 1);
  return toolName.length > 0;
};

const normalizeToolCallName = (tc: Record<string, unknown>): string => {
  const directName = typeof tc.name === "string" ? tc.name.trim() : "";
  let name = directName;
  if (!name) {
    const func = tc.function;
    if (typeof func === "object" && func !== null && !Array.isArray(func)) {
      const funcRecord = func as Record<string, unknown>;
      name = typeof funcRecord.name === "string" ? funcRecord.name.trim() : "";
    }
  }
  if (!name) {
    return "";
  }

  // Sanitize: AI may copy the "[Tool: name#callId]" format from conversation
  // history (used by useAgentLoop to label tool results) or leak internal XML
  // tags (e.g. ``) into the tool name. Extract a valid
  // {server}-{tool} pattern if one is buried in the polluted string.
  const mcpMatch = name.match(/[A-Za-z0-9_-]+-[A-Za-z0-9_-]+/);
  if (mcpMatch) {
    return mcpMatch[0];
  }

  return name;
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

export const parseToolCalls = (
  toolCallsJson: string | undefined
): ToolCallInfo[] => {
  if (!toolCallsJson) {
    return [];
  }

  try {
    const parsed = JSON.parse(toolCallsJson);
    if (Array.isArray(parsed) && parsed.length > 0) {
      const parseBatchId = `${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      return parsed
        .map((tc: unknown, index: number): ToolCallInfo | null => {
          if (typeof tc !== "object" || tc === null || Array.isArray(tc)) {
            return null;
          }
          const record = tc as Record<string, unknown>;
          const name = normalizeToolCallName(record) || "unknown";
          const callId = normalizeToolCallId(record);
          return {
            name,
            arguments: normalizeToolCallArgumentsFromTc(record),
            callId,
            interactionId: callId
              ? `tool-${callId}`
              : `tool-${parseBatchId}-${index}`,
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

export const buildConversationMessages = (
  records: ChatMessageRecord[]
): ChatConversationMessage[] => {
  const toolResultQueues = new Map<string, string[]>();
  for (const record of records) {
    if (record.role !== "tool" || !record.content) {
      continue;
    }

    for (const segment of record.content.split("\n\n")) {
      const match = segment.match(/^\[Tool:\s*(.+?)\]\n([\s\S]*)$/);
      if (!match) {
        continue;
      }
      const queue = toolResultQueues.get(match[1]) ?? [];
      queue.push(match[2]);
      toolResultQueues.set(match[1], queue);
    }
  }

  const consumeToolResult = (toolCall: ToolCallInfo): string | undefined => {
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

  return records
    .filter((record) => record.role !== "tool")
    .map((record) => {
      const toolCalls = parseToolCalls(record.toolCallsJson).map((toolCall) => {
        const result = consumeToolResult(toolCall);
        return {
          ...toolCall,
          status:
            result === undefined ? ("error" as const) : ("completed" as const),
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
        isContextCompaction: record.status === "context_compaction",
      };
    });
};

export const isSameToolCall = (
  candidate: ToolCallInfo,
  target: ToolCallInfo
): boolean =>
  target.callId
    ? candidate.callId === target.callId
    : candidate.name === target.name &&
      candidate.arguments === target.arguments;

export const updateFirstMatchingToolCall = (
  toolCalls: ToolCallInfo[] | undefined,
  target: ToolCallInfo,
  expectedStatus:
    | ToolCallInfo["status"]
    | ReadonlyArray<ToolCallInfo["status"]>,
  update: (toolCall: ToolCallInfo) => ToolCallInfo
): ToolCallInfo[] | undefined => {
  if (!toolCalls) {
    return undefined;
  }

  let hasUpdated = false;
  return toolCalls.map((toolCall) => {
    if (
      hasUpdated ||
      !(Array.isArray(expectedStatus)
        ? expectedStatus.includes(toolCall.status)
        : toolCall.status === expectedStatus) ||
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
export const validateToolCall = (toolCall: ToolCallInfo): string | null => {
  if (!isValidToolName(toolCall.name)) {
    return JSON.stringify({
      error: `Invalid tool name format: "${toolCall.name}". Tool names must follow the format "{server}-{tool}". Please check the available tool definitions and use the correct full name.`,
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
