import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatInputSendOptions } from "../chatInput/types";
import type {
  ApiConfigRecord,
  ChatConversationRecord,
  ChatMessageRecord,
  CheckpointFileChange,
  TokenUsage,
  UserQuestionRequest,
} from "../../../../preload";
import { calculateAutoCompressThresholdTokens } from "../../sidebar/apiSettings/autoCompressThreshold";

export type UserQuestionState = {
  questionId: string;
  question: string;
  options: string[];
  status: "waiting" | "answered" | "cancelled";
  selectedOptions: string[];
  customAnswers: string[];
};

export type ToolCallInfo = {
  name: string;
  arguments: string;
  callId?: string;
  interactionId: string;
  status: "pending" | "running" | "completed" | "error";
  result?: string;
  streamingStdout?: string;
  streamingStderr?: string;
  userQuestion?: UserQuestionState;
  authorizationId?: string;
  authorizationConversationId?: string;
  sensitiveCommandMatches?: Array<{
    commandId: string;
    pattern: string;
    description: string;
  }>;
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
  isRetrying?: boolean;
  retryAttempt?: number;
  retryError?: string;
  /** File-system checkpoint id created when the user sent this message.
   *  Used by rollback to restore the working directory to its pre-AI state. */
  checkpointId?: string;
  isContextCompaction?: boolean;
};
type UpsertedConversation = {
  record: ChatConversationRecord;
  timestamp: number;
};

type SubAgentSessionEvent = {
  parentConversationId: string;
  conversationId: string;
  agentId: string;
  agentName: string;
  status: "running" | "completed" | "failed" | "cancelled";
  timestamp: number;
};

type ConversationSessionState = {
  messages: ChatConversationMessage[];
  messageRecords: ChatMessageRecord[];
  summary: string;
  isStreaming: boolean;
  isAborting: boolean;
  isLoadingOlderMessages: boolean;
  hasMoreMessages: boolean;
  isInitialHistoryLoaded: boolean;
  tokenUsage: TokenUsage | null;
  directoryId?: string;
  hasNewContent: boolean;
  forkedFromConversationId?: string;
  forkMessageCount?: number;
};

type ConversationSessionRef = {
  streamId: string | null;
  isSending: boolean;
  isAbortRequested: boolean;
  directoryId?: string;
  checkpointIds: string[];
  hasAutoCompacted: boolean;
};

type RollbackTodoItem = {
  id: string;
  content: string;
  status: string;
};

type RollbackPreview = {
  messageId: string;
  messageContent: string;
  changes: CheckpointFileChange[];
  checkpointId?: string;
  workDir?: string;
  convId?: string;
  responseId?: string;
  isFirstMessage: boolean;
  isContextCompaction: boolean;
  todoItems: RollbackTodoItem[];
};
type ToolAuthorizationDecision =
  | { status: "approved"; sensitiveCommandConfirmed?: boolean }
  | { status: "rejected"; reason: string };

type PendingToolAuthorization = {
  toolCall: ToolCallInfo;
  resolve: (decision: ToolAuthorizationDecision) => void;
};

type PendingUserQuestion = {
  interactionId: string;
  resolve: (resultJson: string) => void;
  reject: (error: Error) => void;
};

type UserQuestionTarget = {
  sessionKey: string;
  assistantMessageId: string;
};

type UseChatConversationResult = {
  messages: ChatConversationMessage[];
  summary: string;
  conversationVersion: number;
  upsertedConversation: UpsertedConversation | null;
  subAgentSessionEvent: SubAgentSessionEvent | null;
  activeConversationId: string | undefined;
  conversationDirectoryId: string | undefined;
  tokenUsage: TokenUsage | null;
  forkedFromConversationId: string | undefined;
  forkMessageCount: number | undefined;
  streamingConversationIds: Set<string>;
  completedConversationIds: Set<string>;
  isLoadingOlderMessages: boolean;
  hasMoreMessages: boolean;
  isInitialHistoryLoaded: boolean;
  isLoadingInitialHistory: boolean;
  loadOlderMessages: () => Promise<void>;
  handleSendMessage: (message: string, options: ChatInputSendOptions) => void;
  pendingMessages: string[];
  withdrawPendingMessage: (index: number) => string | null;
  compactConversation: (model?: string) => Promise<void>;
  compactionPreview: string;
  compactionError: string | null;
  isCompacting: boolean;
  handleSelectConversation: (
    conversationId: string,
    title?: string,
    tokenUsage?: TokenUsage | null,
    directoryId?: string
  ) => Promise<void>;
  handleNewChat: () => void;
  refreshConversations: () => void;
  isStreaming: boolean;
  isAborting: boolean;
  handleAbort: () => void;
  abortConversation: (conversationId: string) => void;
  handleForkConversation: (
    conversationId: string,
    upToResponseId: string
  ) => Promise<void>;
  draftToRestore: string | null;
  clearDraftToRestore: () => void;
  handleRollback: (messageId: string) => void;
  rollbackPreview: RollbackPreview | null;
  confirmRollback: () => void;
  cancelRollback: () => void;
  yoloMode: boolean;
  isUpdatingYoloMode: boolean;
  setYoloMode: (enabled: boolean) => Promise<void>;
  refreshYoloMode: () => Promise<boolean>;
  pendingToolAuthorizations: ToolCallInfo[];
  approveToolAuthorization: (toolCall: ToolCallInfo) => void;
  approveToolAuthorizationAlways: (toolCall: ToolCallInfo) => void;
  rejectToolAuthorization: (toolCall: ToolCallInfo, reason: string) => void;
  answerUserQuestion: (
    questionId: string,
    selectedOptions: string[],
    customAnswers: string[]
  ) => void;
  cancelUserQuestion: (questionId: string) => void;
};

const PENDING_SESSION_KEY = "__pending__";
const CHAT_MESSAGE_PAGE_SIZE = 10;

const deleteCheckpoints = (checkpointIds: string[]): void => {
  for (const checkpointId of checkpointIds) {
    void window.snow.deleteCheckpoint(checkpointId).catch(() => {
      // Checkpoint cleanup is best effort.
    });
  }
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

const formatMcpToolResultForModel = (result: string): string => {
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

const normalizeToolCallArguments = (args: unknown): string => {
  if (typeof args === "string") {
    return args;
  }
  if (typeof args === "object" && args !== null) {
    return JSON.stringify(args);
  }
  return "{}";
};

const isUserQuestionCancellationResult = (resultJson: string): boolean => {
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

const isValidToolName = (name: string): boolean => {
  // Valid format: mcp__{server_id}__{tool_name}
  const parts = name.split("__");
  return (
    parts.length === 3 &&
    parts[0] === "mcp" &&
    parts[1].length > 0 &&
    parts[2].length > 0
  );
};

const normalizeToolCallName = (tc: Record<string, unknown>): string => {
  const directName = typeof tc.name === "string" ? tc.name.trim() : "";
  if (directName) {
    return directName;
  }
  const func = tc.function;
  if (typeof func === "object" && func !== null && !Array.isArray(func)) {
    const funcRecord = func as Record<string, unknown>;
    return typeof funcRecord.name === "string" ? funcRecord.name.trim() : "";
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
      const parseBatchId = `${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      return parsed
        .map((tc: unknown, index: number): ToolCallInfo | null => {
          if (typeof tc !== "object" || tc === null || Array.isArray(tc)) {
            return null;
          }
          const record = tc as Record<string, unknown>;
          const name = normalizeToolCallName(record);
          if (!name) {
            return null;
          }
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

const buildConversationMessages = (
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

const isSameToolCall = (
  candidate: ToolCallInfo,
  target: ToolCallInfo
): boolean =>
  target.callId
    ? candidate.callId === target.callId
    : candidate.name === target.name &&
      candidate.arguments === target.arguments;

const updateFirstMatchingToolCall = (
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
const validateToolCall = (toolCall: ToolCallInfo): string | null => {
  if (!isValidToolName(toolCall.name)) {
    return JSON.stringify({
      error: `Invalid tool name format: "${toolCall.name}". Tool names must follow the format "mcp__{server}__{tool}". Please check the available tool definitions and use the correct full name.`,
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

export const useChatConversation = (
  directoryId?: string,
  directoryPath?: string
): UseChatConversationResult => {
  const [sessions, setSessions] = useState<
    Record<string, ConversationSessionState>
  >({});
  const [activeConversationId, setActiveConversationId] = useState<
    string | undefined
  >(undefined);
  const [conversationVersion, setConversationVersion] = useState(0);
  const [upsertedConversation, setUpsertedConversation] =
    useState<UpsertedConversation | null>(null);
  const [subAgentSessionEvent, setSubAgentSessionEvent] =
    useState<SubAgentSessionEvent | null>(null);
  const [streamingConversationIds, setStreamingConversationIds] = useState<
    Set<string>
  >(new Set());
  const [completedConversationIds, setCompletedConversationIds] = useState<
    Set<string>
  >(new Set());
  const [isLoadingInitialHistory, setIsLoadingInitialHistory] = useState(false);
  const [draftToRestore, setDraftToRestore] = useState<string | null>(null);
  const [rollbackPreview, setRollbackPreview] =
    useState<RollbackPreview | null>(null);
  const [yoloMode, setYoloModeState] = useState(false);
  const [isUpdatingYoloMode, setIsUpdatingYoloMode] = useState(false);
  const [pendingToolAuthorizations, setPendingToolAuthorizations] = useState<
    ToolCallInfo[]
  >([]);

  const sessionsRefData = useRef<Map<string, ConversationSessionRef>>(
    new Map()
  );
  const activeConversationIdRef = useRef<string | undefined>(undefined);
  const selectionRequestIdRef = useRef(0);
  const loadingOlderConversationIdsRef = useRef(new Set<string>());
  // Keep a ref to the latest sessions so async callbacks (e.g. handleRollback)
  // can read the current messages without stale closures.
  const sessionsRef = useRef<Record<string, ConversationSessionState>>({});
  sessionsRef.current = sessions;

  const pendingQueueRef = useRef<
    Map<string, Array<{ text: string; options: ChatInputSendOptions }>>
  >(new Map());
  const [activePendingMessages, setActivePendingMessages] = useState<string[]>(
    []
  );
  const [compactionPreview, setCompactionPreview] = useState("");
  const [compactionError, setCompactionError] = useState<string | null>(null);
  const [isCompacting, setIsCompacting] = useState(false);
  const handleSendMessageRef = useRef<
    (message: string, options: ChatInputSendOptions) => void
  >(() => {});
  const performCompactionRef = useRef<
    (
      conversationId: string,
      model?: string,
      isAuto?: boolean
    ) => Promise<string | null>
  >(async () => null);
  const yoloModeRef = useRef(yoloMode);
  const alwaysApprovedToolsRef = useRef(new Set<string>());
  const pendingToolAuthorizationRef = useRef(
    new Map<string, PendingToolAuthorization>()
  );
  const pendingUserQuestionRef = useRef(new Map<string, PendingUserQuestion>());
  const userQuestionTargetRef = useRef(new Map<string, UserQuestionTarget>());
  const activeApiConfigRef = useRef<ApiConfigRecord | null>(null);
  yoloModeRef.current = yoloMode;

  // Load the active API config once so the auto-compaction check can read
  // enableAutoCompress / autoCompressThreshold / maxContextTokens without
  // an extra IPC round-trip on every token-usage update.
  useEffect(() => {
    let disposed = false;
    void window.snow
      .listApiConfigs()
      .then((configs) => {
        if (disposed) {
          return;
        }
        activeApiConfigRef.current =
          configs.find((c) => c.isActive) ?? configs[0] ?? null;
      })
      .catch(() => {
        // Best effort — auto-compaction simply won't trigger if config is unavailable.
      });
    return () => {
      disposed = true;
    };
  }, []);

  const approveAllPendingToolAuthorizations = useCallback((): void => {
    const pendingEntries = pendingToolAuthorizationRef.current;
    if (pendingEntries.size === 0) {
      return;
    }

    const approvedAuthorizationIds: string[] = [];
    pendingEntries.forEach((entry, authorizationId) => {
      if ((entry.toolCall.sensitiveCommandMatches?.length ?? 0) > 0) {
        return;
      }

      entry.resolve({ status: "approved" });
      approvedAuthorizationIds.push(authorizationId);
    });
    approvedAuthorizationIds.forEach((authorizationId) =>
      pendingEntries.delete(authorizationId)
    );
    setPendingToolAuthorizations((current) =>
      current.filter(
        (toolCall) =>
          !toolCall.authorizationId ||
          !approvedAuthorizationIds.includes(toolCall.authorizationId)
      )
    );
  }, []);

  const applyYoloMode = useCallback(
    (enabled: boolean): void => {
      yoloModeRef.current = enabled;
      setYoloModeState(enabled);
      if (enabled) {
        approveAllPendingToolAuthorizations();
      }
    },
    [approveAllPendingToolAuthorizations]
  );

  const refreshYoloMode = useCallback(async (): Promise<boolean> => {
    try {
      const enabled = await window.snow.getYoloMode();
      applyYoloMode(enabled);
      return enabled;
    } catch {
      applyYoloMode(false);
      return false;
    }
  }, [applyYoloMode]);

  useEffect(() => {
    let disposed = false;

    void window.snow
      .getYoloMode()
      .then((enabled) => {
        if (!disposed) {
          applyYoloMode(enabled);
        }
      })
      .catch(() => {
        if (!disposed) {
          applyYoloMode(false);
        }
      });

    void window.snow
      .listAlwaysApprovedTools(directoryPath)
      .then((toolNames) => {
        if (!disposed) {
          alwaysApprovedToolsRef.current = new Set(toolNames);
        }
      })
      .catch(() => {
        if (!disposed) {
          alwaysApprovedToolsRef.current = new Set();
        }
      });

    return () => {
      disposed = true;
    };
  }, [applyYoloMode, directoryPath]);

  const setYoloMode = useCallback(
    async (enabled: boolean): Promise<void> => {
      if (isUpdatingYoloMode) {
        return;
      }

      setIsUpdatingYoloMode(true);
      try {
        await window.snow.setYoloMode(enabled);
        applyYoloMode(enabled);
      } finally {
        setIsUpdatingYoloMode(false);
      }
    },
    [applyYoloMode, isUpdatingYoloMode]
  );

  const settleToolAuthorization = useCallback(
    (toolCall: ToolCallInfo, decision: ToolAuthorizationDecision): void => {
      const authorizationId = toolCall.authorizationId;
      if (!authorizationId) {
        return;
      }

      const pending = pendingToolAuthorizationRef.current.get(authorizationId);
      if (!pending) {
        return;
      }

      // Resolve only this tool's authorization. Rejecting one tool in a
      // parallel batch must not cascade-reject the remaining tools.
      pendingToolAuthorizationRef.current.delete(authorizationId);
      setPendingToolAuthorizations((current) =>
        current.filter((item) => item.authorizationId !== authorizationId)
      );
      pending.resolve(decision);
    },
    []
  );

  const rejectAllToolAuthorizations = useCallback((): void => {
    const pendingEntries = pendingToolAuthorizationRef.current;
    pendingEntries.forEach((entry) =>
      entry.resolve({
        status: "rejected",
        reason: "Tool execution interrupted",
      })
    );
    pendingEntries.clear();
    setPendingToolAuthorizations([]);
  }, []);

  const rejectPendingUserQuestions = useCallback(
    (sessionKey?: string): void => {
      for (const [questionId, pending] of pendingUserQuestionRef.current) {
        const target = userQuestionTargetRef.current.get(pending.interactionId);
        if (sessionKey && target?.sessionKey !== sessionKey) {
          continue;
        }

        pending.reject(new Error("User question interrupted"));
        pendingUserQuestionRef.current.delete(questionId);
        userQuestionTargetRef.current.delete(pending.interactionId);
      }
    },
    []
  );

  const requestToolAuthorization = useCallback(
    (
      toolCall: ToolCallInfo,
      index: number,
      conversationId: string,
      projectId?: string
    ): Promise<ToolAuthorizationDecision> => {
      if (toolCall.name === "mcp__user-interaction__askUserQuestion") {
        return Promise.resolve({ status: "approved" });
      }

      const shouldAutoApprove = () =>
        yoloModeRef.current ||
        alwaysApprovedToolsRef.current.has(toolCall.name);

      // Sensitive command check: even in YOLO mode, bash commands that match
      // the current project's merged rules must be confirmed.
      const checkSensitiveBash = async (): Promise<
        ToolAuthorizationDecision | "needs-dialog"
      > => {
        if (toolCall.name !== "mcp__bash__terminal-execute") {
          return shouldAutoApprove() ? { status: "approved" } : "needs-dialog";
        }

        let command = "";
        try {
          const parsed = JSON.parse(toolCall.arguments || "{}");
          if (typeof parsed?.command === "string") {
            command = parsed.command;
          }
        } catch {
          // ignore parse error
        }

        if (!command) {
          return shouldAutoApprove() ? { status: "approved" } : "needs-dialog";
        }

        try {
          const matches = await window.snow.checkSensitiveCommandMatch(
            command,
            projectId
          );
          if (matches.length > 0) {
            // Sensitive command detected — force authorization dialog
            // even in YOLO mode.
            const authorizationId = `${
              toolCall.callId ?? toolCall.name
            }-${index}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const pendingToolCall: ToolCallInfo = {
              ...toolCall,
              authorizationId,
              authorizationConversationId: conversationId,
              sensitiveCommandMatches: matches,
            };

            return new Promise<ToolAuthorizationDecision>((resolve) => {
              pendingToolAuthorizationRef.current.set(authorizationId, {
                toolCall: pendingToolCall,
                resolve,
              });
              setPendingToolAuthorizations((current) => [
                ...current,
                pendingToolCall,
              ]);
            });
          }
        } catch {
          // If the check fails, fall through to normal authorization flow.
        }

        return shouldAutoApprove() ? { status: "approved" } : "needs-dialog";
      };

      return checkSensitiveBash().then((decision) => {
        if (decision !== "needs-dialog") {
          return decision;
        }

        // Normal authorization flow (non-YOLO, non-sensitive).
        const authorizationId = `${
          toolCall.callId ?? toolCall.name
        }-${index}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const pendingToolCall = {
          ...toolCall,
          authorizationId,
          authorizationConversationId: conversationId,
        };

        return new Promise<ToolAuthorizationDecision>((resolve) => {
          pendingToolAuthorizationRef.current.set(authorizationId, {
            toolCall: pendingToolCall,
            resolve,
          });
          setPendingToolAuthorizations((current) => [
            ...current,
            pendingToolCall,
          ]);
        });
      });
    },
    []
  );

  const requestToolAuthorizations = useCallback(
    async (
      toolCalls: ToolCallInfo[],
      conversationId: string,
      projectId?: string
    ): Promise<ToolAuthorizationDecision[]> => {
      // Read the persisted app setting once per tool batch so recent YOLO
      // changes take effect without querying SQLite for every tool.
      try {
        const enabled = await window.snow.getYoloMode();
        applyYoloMode(enabled);
      } catch {
        // Keep the last known in-memory state if the read fails.
      }

      return Promise.all(
        toolCalls.map((toolCall, index) =>
          requestToolAuthorization(toolCall, index, conversationId, projectId)
        )
      );
    },
    [applyYoloMode, requestToolAuthorization]
  );

  const approveToolAuthorizationAlways = useCallback(
    (toolCall: ToolCallInfo): void => {
      void window.snow
        .addAlwaysApprovedTool(directoryPath, toolCall.name)
        .then(() => {
          alwaysApprovedToolsRef.current.add(toolCall.name);
        })
        .catch(() => {
          // The current execution can continue even if persistence fails.
        })
        .finally(() =>
          settleToolAuthorization(toolCall, { status: "approved" })
        );
    },
    [directoryPath, settleToolAuthorization]
  );

  useEffect(
    () => () => rejectAllToolAuthorizations(),
    [rejectAllToolAuthorizations]
  );

  const setActiveId = useCallback((id: string | undefined): void => {
    activeConversationIdRef.current = id;
    setActiveConversationId(id);
  }, []);

  const ensureSession = useCallback((key: string, dirId?: string): void => {
    if (!sessionsRefData.current.has(key)) {
      sessionsRefData.current.set(key, {
        streamId: null,
        isSending: false,
        isAbortRequested: false,
        directoryId: dirId,
        checkpointIds: [],
        hasAutoCompacted: false,
      });
    }
    setSessions((prev) => {
      if (prev[key]) return prev;
      return {
        ...prev,
        [key]: {
          messages: [],
          messageRecords: [],
          summary: "",
          isStreaming: false,
          isAborting: false,
          isLoadingOlderMessages: false,
          hasMoreMessages: false,
          isInitialHistoryLoaded: true,
          tokenUsage: null,
          directoryId: dirId,
          hasNewContent: false,
        },
      };
    });
  }, []);

  const updateSessionMessages = useCallback(
    (
      key: string,
      updater: (
        messages: ChatConversationMessage[]
      ) => ChatConversationMessage[]
    ): void => {
      setSessions((prev) => {
        const session = prev[key];
        if (!session) return prev;
        return {
          ...prev,
          [key]: { ...session, messages: updater(session.messages) },
        };
      });
    },
    []
  );

  useEffect(() => {
    const unregister = window.snow.registerUserQuestionHandler(
      (request: UserQuestionRequest): Promise<string> => {
        const target = userQuestionTargetRef.current.get(request.interactionId);
        if (!target) {
          return Promise.reject(
            new Error("No active tool call matches this user question")
          );
        }

        updateSessionMessages(target.sessionKey, (currentMessages) =>
          currentMessages.map((message) => {
            if (message.id !== target.assistantMessageId) {
              return message;
            }

            return {
              ...message,
              toolCalls: message.toolCalls?.map((toolCall) =>
                toolCall.interactionId === request.interactionId
                  ? {
                      ...toolCall,
                      userQuestion: {
                        questionId: request.questionId,
                        question: request.question,
                        options: request.options,
                        status: "waiting" as const,
                        selectedOptions: [],
                        customAnswers: [],
                      },
                    }
                  : toolCall
              ),
            };
          })
        );

        return new Promise<string>((resolve, reject) => {
          pendingUserQuestionRef.current.set(request.questionId, {
            interactionId: request.interactionId,
            resolve,
            reject,
          });
        });
      }
    );

    return () => {
      unregister();
      for (const pending of pendingUserQuestionRef.current.values()) {
        pending.reject(new Error("User question handler was disposed"));
      }
      pendingUserQuestionRef.current.clear();
      userQuestionTargetRef.current.clear();
    };
  }, [updateSessionMessages]);

  const settleUserQuestion = useCallback(
    (
      questionId: string,
      cancelled: boolean,
      selectedOptions: string[],
      customAnswers: string[]
    ): void => {
      const pending = pendingUserQuestionRef.current.get(questionId);
      if (!pending) {
        return;
      }

      const normalizeAnswers = (values: string[]): string[] =>
        Array.from(
          new Set(values.map((value) => value.trim()).filter(Boolean))
        );
      const normalizedSelected = cancelled
        ? []
        : normalizeAnswers(selectedOptions);
      const normalizedCustom = cancelled ? [] : normalizeAnswers(customAnswers);
      const answers = normalizeAnswers([
        ...normalizedSelected,
        ...normalizedCustom,
      ]);
      if (!cancelled && answers.length === 0) {
        return;
      }

      const target = userQuestionTargetRef.current.get(pending.interactionId);
      if (target) {
        updateSessionMessages(target.sessionKey, (currentMessages) =>
          currentMessages.map((message) => {
            if (message.id !== target.assistantMessageId) {
              return message;
            }

            return {
              ...message,
              toolCalls: message.toolCalls?.map((toolCall) =>
                toolCall.interactionId === pending.interactionId &&
                toolCall.userQuestion?.questionId === questionId
                  ? {
                      ...toolCall,
                      userQuestion: {
                        ...toolCall.userQuestion,
                        status: cancelled
                          ? ("cancelled" as const)
                          : ("answered" as const),
                        selectedOptions: normalizedSelected,
                        customAnswers: normalizedCustom,
                      },
                    }
                  : toolCall
              ),
            };
          })
        );
      }

      pendingUserQuestionRef.current.delete(questionId);
      userQuestionTargetRef.current.delete(pending.interactionId);
      pending.resolve(
        JSON.stringify({
          cancelled,
          answers,
          selectedOptions: normalizedSelected,
          customAnswers: normalizedCustom,
        })
      );
    },
    [updateSessionMessages]
  );

  const answerUserQuestion = useCallback(
    (
      questionId: string,
      selectedOptions: string[],
      customAnswers: string[]
    ): void => {
      settleUserQuestion(questionId, false, selectedOptions, customAnswers);
    },
    [settleUserQuestion]
  );

  const cancelUserQuestion = useCallback(
    (questionId: string): void => {
      settleUserQuestion(questionId, true, [], []);
    },
    [settleUserQuestion]
  );

  const updateSessionField = useCallback(
    <K extends keyof ConversationSessionState>(
      key: string,
      field: K,
      value: ConversationSessionState[K]
    ): void => {
      setSessions((prev) => {
        const session = prev[key];
        if (!session) return prev;
        return { ...prev, [key]: { ...session, [field]: value } };
      });
    },
    []
  );

  const migrateSession = useCallback((oldKey: string, newKey: string): void => {
    const oldRef = sessionsRefData.current.get(oldKey);
    if (oldRef) {
      sessionsRefData.current.set(newKey, { ...oldRef });
      sessionsRefData.current.delete(oldKey);
    }

    const pendingQueue = pendingQueueRef.current.get(oldKey);
    if (pendingQueue?.length) {
      const existingPendingQueue = pendingQueueRef.current.get(newKey) ?? [];
      pendingQueueRef.current.set(newKey, [
        ...pendingQueue,
        ...existingPendingQueue,
      ]);
      pendingQueueRef.current.delete(oldKey);
    }

    setSessions((prev) => {
      const oldSession = prev[oldKey];
      if (!oldSession) return prev;
      const next = { ...prev };
      next[newKey] = oldSession;
      delete next[oldKey];
      return next;
    });
    setStreamingConversationIds((prev) => {
      if (!prev.has(oldKey)) return prev;
      const next = new Set(prev);
      next.delete(oldKey);
      next.add(newKey);
      return next;
    });
  }, []);

  const addStreamingId = useCallback((id: string): void => {
    setStreamingConversationIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const removeStreamingId = useCallback((id: string): void => {
    setStreamingConversationIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const handleSendMessage = useCallback(
    (message: string, options: ChatInputSendOptions) => {
      const trimmed = message.trim();
      if (!trimmed) {
        return;
      }

      const sessionKey = activeConversationIdRef.current ?? PENDING_SESSION_KEY;
      const existingRef = sessionsRefData.current.get(sessionKey);
      if (existingRef?.isSending) {
        const queue = pendingQueueRef.current.get(sessionKey) ?? [];
        queue.push({ text: trimmed, options });
        pendingQueueRef.current.set(sessionKey, queue);
        setActivePendingMessages(queue.map((item) => item.text));
        return;
      }

      const isFirstMessage = activeConversationIdRef.current === undefined;
      const sessionDirId = existingRef?.directoryId ?? directoryId;

      ensureSession(sessionKey, sessionDirId);
      const sessionRef = sessionsRefData.current.get(sessionKey);
      if (sessionRef) {
        sessionRef.isSending = true;
        sessionRef.isAbortRequested = false;
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
        content: "",
        timestamp: formatMessageTime(),
        status: "sending",
        model: options.model,
      };

      updateSessionField(sessionKey, "isStreaming", true);
      addStreamingId(sessionKey);
      updateSessionMessages(sessionKey, (currentMessages) => [
        ...currentMessages,
        userMessage,
        pendingAssistantMessage,
      ]);

      // First message: immediately show a placeholder in the sidebar list
      // so the user sees the new conversation without waiting for AI response.
      if (isFirstMessage) {
        const nowIso = new Date().toISOString();
        const preview =
          trimmed.length > 50 ? `${trimmed.slice(0, 50)}...` : trimmed;
        setUpsertedConversation({
          record: {
            conversationId: PENDING_SESSION_KEY,
            title: trimmed,
            summary: "",
            lastMessagePreview: preview,
            messageCount: 1,
            model: options.model ?? "",
            status: "active",
            directoryId: sessionDirId ?? "",
            forkedFromConversationId: "",
            forkMessageCount: 0,
            conversationType: "main",
            parentConversationId: "",
            subAgentId: "",
            subAgentName: "",
            subAgentStatus: "",
            subAgentError: "",
            createdAt: nowIso,
            updatedAt: nowIso,
            inputTokens: 0,
            outputTokens: 0,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
          },
          timestamp: Date.now(),
        });
      }

      let finalSessionKey = sessionKey;

      const executeSubAgentActivation = async (
        argsJson: string,
        parentConversationId: string,
        dirId: string
      ): Promise<string> => {
        const parsedArgs = JSON.parse(argsJson) as Record<string, unknown>;
        const agentId =
          typeof parsedArgs.agentId === "string" ? parsedArgs.agentId : "";
        const prompt =
          typeof parsedArgs.prompt === "string" ? parsedArgs.prompt : "";

        if (!agentId || !prompt) {
          return JSON.stringify({
            success: false,
            error: "agentId and prompt are required",
          });
        }
        let subConversationId: string | undefined;
        let subAgentName: string | undefined;
        let config: Awaited<ReturnType<typeof window.snow.getSubAgentConfig>> =
          null;

        try {
          config = await window.snow.getSubAgentConfig(agentId);
          if (!config) {
            return JSON.stringify({
              success: false,
              error: `Sub-agent configuration not found: ${agentId}`,
            });
          }

          subConversationId = `sub-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 10)}`;
          const title =
            prompt.length > 80 ? `${prompt.slice(0, 80)}...` : prompt;

          await window.snow.createSubAgentSession(
            subConversationId,
            parentConversationId,
            agentId,
            config.name,
            dirId,
            options.model ?? "",
            title
          );

          await window.snow.updateSubAgentSessionStatus(
            subConversationId,
            "running",
            ""
          );

          setSubAgentSessionEvent({
            parentConversationId,
            conversationId: subConversationId,
            agentId,
            agentName: config.name,
            status: "running",
            timestamp: Date.now(),
          });

          const allowedTools = JSON.parse(config.toolsJson) as string[];
          const subAgentToolsJson = config.toolsJson;
          subAgentName = config.name;

          const subConvId = subConversationId!;
          ensureSession(subConvId, dirId);
          const subSessionRef = sessionsRefData.current.get(subConvId);
          if (subSessionRef) {
            subSessionRef.isSending = true;
            subSessionRef.isAbortRequested = false;
          }
          updateSessionField(subConvId, "isStreaming", true);
          addStreamingId(subConvId);

          const subUserMessage: ChatConversationMessage = {
            id: createMessageId("user"),
            role: "user",
            content: prompt,
            timestamp: formatMessageTime(),
            status: "sent",
          };

          updateSessionMessages(subConvId, (currentMessages) => [
            ...currentMessages,
            subUserMessage,
          ]);

          const subAgentRunLoop = async (
            subMessages: {
              role: "user" | "assistant" | "system" | "developer" | "tool";
              content: string;
            }[]
          ): Promise<string> => {
            if (sessionsRefData.current.get(subConvId)?.isAbortRequested) {
              return "Sub-agent interrupted by user";
            }

            const subAssistantMessageId = createMessageId("assistant");
            const subAssistantMessage: ChatConversationMessage = {
              id: subAssistantMessageId,
              role: "assistant",
              content: "",
              timestamp: formatMessageTime(),
              status: "sending",
            };

            updateSessionMessages(subConvId, (currentMessages) => [
              ...currentMessages,
              subAssistantMessage,
            ]);

            const subResponse = await window.snow.createResponseStream(
              {
                messages: subMessages,
                model: options.model,
                conversationId: subConvId,
                directoryId: dirId,
                subAgentToolsJson: subAgentToolsJson,
              },
              (chunk) => {
                if (sessionsRefData.current.get(subConvId)?.isAbortRequested) {
                  return;
                }
                updateSessionMessages(subConvId, (currentMessages) =>
                  currentMessages.map((currentMessage) => {
                    if (currentMessage.id !== subAssistantMessageId) {
                      return currentMessage;
                    }

                    if (chunk.retrying) {
                      return {
                        ...currentMessage,
                        isRetrying: true,
                        retryAttempt: chunk.retryAttempt ?? undefined,
                        retryError: chunk.retryError ?? undefined,
                        status: "sending",
                      };
                    }

                    const existingContent = currentMessage.content;
                    const nextContent =
                      chunk.content ||
                      `${existingContent}${chunk.contentDelta}`;
                    const nextThinking =
                      chunk.thinking ||
                      `${currentMessage.thinking ?? ""}${chunk.thinkingDelta}`;

                    return {
                      ...currentMessage,
                      content: nextContent,
                      thinking: nextThinking || undefined,
                      timestamp: formatMessageTime(),
                      status: "sending",
                      isRetrying: false,
                    };
                  })
                );
              },
              (streamId: string) => {
                const ref = sessionsRefData.current.get(subConvId);
                if (ref) {
                  ref.streamId = streamId;
                  if (ref.isAbortRequested) {
                    void window.snow.abortResponseStream(streamId);
                  }
                }
              }
            );

            const subRef = sessionsRefData.current.get(subConvId);
            if (subRef) {
              subRef.streamId = null;
            }

            if (sessionsRefData.current.get(subConvId)?.isAbortRequested) {
              updateSessionMessages(subConvId, (currentMessages) =>
                currentMessages.map((currentMessage) =>
                  currentMessage.id === subAssistantMessageId
                    ? {
                        ...currentMessage,
                        status: "sent" as const,
                        content:
                          currentMessage.content ||
                          "Sub-agent interrupted by user",
                        isRetrying: false,
                      }
                    : currentMessage
                )
              );
              return "Sub-agent interrupted by user";
            }

            if (subResponse.tokenUsage) {
              updateSessionField(
                subConvId,
                "tokenUsage",
                subResponse.tokenUsage
              );
            }

            const subToolCalls = parseToolCalls(subResponse.toolCallsJson);

            if (subToolCalls.length === 0) {
              updateSessionMessages(subConvId, (currentMessages) =>
                currentMessages.map((currentMessage) =>
                  currentMessage.id === subAssistantMessageId
                    ? {
                        ...currentMessage,
                        content:
                          subResponse.content ||
                          currentMessage.content ||
                          "Sub-agent completed with no output.",
                        status: "sent" as const,
                        responseId: subResponse.id || undefined,
                        model: subResponse.model || undefined,
                        isRetrying: false,
                      }
                    : currentMessage
                )
              );

              return (
                subResponse.content || "Sub-agent completed with no output."
              );
            }

            updateSessionMessages(subConvId, (currentMessages) =>
              currentMessages.map((currentMessage) =>
                currentMessage.id === subAssistantMessageId
                  ? {
                      ...currentMessage,
                      content: subResponse.content || "",
                      thinking: subResponse.thinking || undefined,
                      toolCalls: subToolCalls.map((tc) => ({
                        ...tc,
                        status: "pending" as const,
                      })),
                      status: "sent" as const,
                      responseId: subResponse.id || undefined,
                      model: subResponse.model || undefined,
                      isRetrying: false,
                    }
                  : currentMessage
              )
            );

            const subAuthorizationDecisions = await requestToolAuthorizations(
              subToolCalls,
              subConvId,
              dirId
            );

            const subToolResults: string[] = [];
            for (
              let subToolIndex = 0;
              subToolIndex < subToolCalls.length;
              subToolIndex++
            ) {
              const subToolCall = subToolCalls[subToolIndex];
              const subAuthorizationDecision =
                subAuthorizationDecisions[subToolIndex];

              if (sessionsRefData.current.get(subConvId)?.isAbortRequested) {
                return "Sub-agent interrupted by user";
              }

              if (subAuthorizationDecision.status === "rejected") {
                const subRejectResult = JSON.stringify({
                  success: false,
                  error: "TOOL_EXECUTION_DENIED_BY_USER",
                  reason:
                    subAuthorizationDecision.reason ||
                    "User declined tool execution",
                });
                subToolResults.push(
                  `[Tool: ${subToolCall.name}]\n${formatMcpToolResultForModel(
                    subRejectResult
                  )}`
                );

                updateSessionMessages(subConvId, (currentMessages) =>
                  currentMessages.map((currentMessage) => {
                    if (currentMessage.id !== subAssistantMessageId) {
                      return currentMessage;
                    }
                    return {
                      ...currentMessage,
                      toolCalls: updateFirstMatchingToolCall(
                        currentMessage.toolCalls,
                        subToolCall,
                        ["pending"],
                        (currentToolCall) => ({
                          ...currentToolCall,
                          status: "completed" as const,
                          result: subRejectResult,
                        })
                      ),
                    };
                  })
                );
                continue;
              }

              let subSensitiveAuthorizationToken: string | undefined;
              if (
                subToolCall.name === "mcp__bash__terminal-execute" &&
                subAuthorizationDecision.status === "approved" &&
                subAuthorizationDecision.sensitiveCommandConfirmed === true
              ) {
                try {
                  const subParsedArgs = JSON.parse(
                    subToolCall.arguments || "{}"
                  ) as Record<string, unknown>;
                  if (typeof subParsedArgs.command !== "string") {
                    throw new Error("Sensitive command argument is missing");
                  }
                  subSensitiveAuthorizationToken =
                    await window.snow.issueSensitiveCommandAuthorization(
                      subParsedArgs.command
                    );
                } catch {
                  // If authorization fails, let the tool fail naturally.
                }
              }

              updateSessionMessages(subConvId, (currentMessages) =>
                currentMessages.map((currentMessage) => {
                  if (currentMessage.id !== subAssistantMessageId) {
                    return currentMessage;
                  }
                  return {
                    ...currentMessage,
                    toolCalls: updateFirstMatchingToolCall(
                      currentMessage.toolCalls,
                      subToolCall,
                      ["pending"],
                      (currentToolCall) => ({
                        ...currentToolCall,
                        status: "running" as const,
                      })
                    ),
                  };
                })
              );

              let subResult: string;
              try {
                subResult = await window.snow.callMcpTool(
                  subToolCall.name,
                  subToolCall.arguments,
                  dirId,
                  [],
                  undefined,
                  subSensitiveAuthorizationToken,
                  (chunk) => {
                    if (!chunk.data) {
                      return;
                    }
                    updateSessionMessages(subConvId, (currentMessages) =>
                      currentMessages.map((currentMessage) => {
                        if (currentMessage.id !== subAssistantMessageId) {
                          return currentMessage;
                        }
                        return {
                          ...currentMessage,
                          toolCalls: updateFirstMatchingToolCall(
                            currentMessage.toolCalls,
                            subToolCall,
                            ["pending", "running"],
                            (currentToolCall) => ({
                              ...currentToolCall,
                              streamingStdout:
                                chunk.stream === "stdout"
                                  ? `${currentToolCall.streamingStdout ?? ""}${
                                      chunk.data
                                    }`
                                  : currentToolCall.streamingStdout,
                              streamingStderr:
                                chunk.stream === "stderr"
                                  ? `${currentToolCall.streamingStderr ?? ""}${
                                      chunk.data
                                    }`
                                  : currentToolCall.streamingStderr,
                            })
                          ),
                        };
                      })
                    );
                  },
                  subToolCall.interactionId,
                  allowedTools
                );
              } catch (err) {
                subResult = JSON.stringify({ error: getErrorMessage(err) });
              }

              updateSessionMessages(subConvId, (currentMessages) =>
                currentMessages.map((currentMessage) => {
                  if (currentMessage.id !== subAssistantMessageId) {
                    return currentMessage;
                  }
                  return {
                    ...currentMessage,
                    toolCalls: updateFirstMatchingToolCall(
                      currentMessage.toolCalls,
                      subToolCall,
                      ["pending", "running"],
                      (currentToolCall) => ({
                        ...currentToolCall,
                        status: "completed" as const,
                        result: subResult,
                      })
                    ),
                  };
                })
              );

              const subIdentifier = subToolCall.callId
                ? `${subToolCall.name}#${subToolCall.callId}`
                : subToolCall.name;
              subToolResults.push(
                `[Tool: ${subIdentifier}]\n${formatMcpToolResultForModel(
                  subResult
                )}`
              );
            }

            const subToolResultMessage: ChatConversationMessage = {
              id: createMessageId("tool"),
              role: "tool",
              content: subToolResults.join("\n\n"),
              timestamp: formatMessageTime(),
              status: "sent",
              toolName: subToolCalls.map((tc) => tc.name).join(", "),
            };

            updateSessionMessages(subConvId, (currentMessages) => [
              ...currentMessages,
              subToolResultMessage,
            ]);

            // Flush pending user messages before the next AI request so
            // they are sent in the next iteration as soon as tools finish.
            const subPendingForTools =
              pendingQueueRef.current.get(subConvId) ?? [];
            const subNextMessages: {
              role: "user" | "assistant" | "system" | "developer" | "tool";
              content: string;
            }[] = [{ role: "tool", content: subToolResults.join("\n\n") }];
            if (subPendingForTools.length > 0) {
              pendingQueueRef.current.delete(subConvId);
              const subPendingText = subPendingForTools
                .map((item) => item.text)
                .join("\n\n");
              setActivePendingMessages([]);
              const subPendingUserMsg: ChatConversationMessage = {
                id: createMessageId("user"),
                role: "user",
                content: subPendingText,
                timestamp: formatMessageTime(),
                status: "sent",
              };
              updateSessionMessages(subConvId, (currentMessages) => [
                ...currentMessages,
                subPendingUserMsg,
              ]);
              subNextMessages.push({ role: "user", content: subPendingText });
            }

            return subAgentRunLoop(subNextMessages);
          };

          const summary = await subAgentRunLoop([
            { role: "user", content: prompt },
          ]);

          const subFinalRef = sessionsRefData.current.get(subConvId);
          if (subFinalRef) {
            subFinalRef.isSending = false;
          }
          updateSessionField(subConvId, "isStreaming", false);
          updateSessionField(subConvId, "isAborting", false);
          removeStreamingId(subConvId);

          const subPendingQueue = pendingQueueRef.current.get(subConvId) ?? [];
          if (!subFinalRef?.isAbortRequested && subPendingQueue.length > 0) {
            pendingQueueRef.current.delete(subConvId);
            const combined = subPendingQueue
              .map((item) => item.text)
              .join("\n\n");
            const lastOptions =
              subPendingQueue[subPendingQueue.length - 1]?.options ?? {};
            setActivePendingMessages([]);
            handleSendMessageRef.current(combined, lastOptions);
          }

          await window.snow.updateSubAgentSessionStatus(
            subConvId,
            "completed",
            ""
          );

          setSubAgentSessionEvent({
            parentConversationId,
            conversationId: subConversationId,
            agentId,
            agentName: subAgentName,
            status: "completed",
            timestamp: Date.now(),
          });

          return JSON.stringify({
            success: true,
            conversationId: subConversationId,
            agentName: subAgentName,
            summary,
          });
        } catch (err) {
          if (subConversationId) {
            const subCatchRef = sessionsRefData.current.get(subConversationId);
            if (subCatchRef) {
              subCatchRef.isSending = false;
            }
            updateSessionField(subConversationId, "isStreaming", false);
            updateSessionField(subConversationId, "isAborting", false);
            removeStreamingId(subConversationId);

            await window.snow
              .updateSubAgentSessionStatus(subConversationId, "failed", "")
              .catch(() => {});

            setSubAgentSessionEvent({
              parentConversationId,
              conversationId: subConversationId,
              agentId,
              agentName: subAgentName ?? agentId,
              status: "failed",
              timestamp: Date.now(),
            });
          }

          return JSON.stringify({
            success: false,
            error: getErrorMessage(err),
          });
        }
      };

      const runAgentLoop = async (
        currentAssistantMessageId: string,
        requestMessages: {
          role: "user" | "assistant" | "system" | "developer" | "tool";
          content: string;
        }[],
        currentConversationId: string | undefined,
        checkpointId?: string
      ): Promise<void> => {
        const iterSessionKey = currentConversationId ?? PENDING_SESSION_KEY;
        let effectiveKey = iterSessionKey;

        if (sessionsRefData.current.get(effectiveKey)?.isAbortRequested) {
          return;
        }

        const response = await window.snow.createResponseStream(
          {
            messages: requestMessages,
            model: options.model,
            conversationId: currentConversationId,
            directoryId: sessionDirId,
            checkpointId,
          },
          (chunk) => {
            if (sessionsRefData.current.get(effectiveKey)?.isAbortRequested) {
              return;
            }

            updateSessionMessages(effectiveKey, (currentMessages) =>
              currentMessages.map((currentMessage) => {
                if (currentMessage.id !== currentAssistantMessageId) {
                  return currentMessage;
                }

                if (chunk.retrying) {
                  return {
                    ...currentMessage,
                    isRetrying: true,
                    retryAttempt: chunk.retryAttempt ?? undefined,
                    retryError: chunk.retryError ?? undefined,
                    status: "sending",
                  };
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
                  isRetrying: false,
                };
              })
            );
          },
          (streamId: string) => {
            const ref = sessionsRefData.current.get(effectiveKey);
            if (ref) {
              ref.streamId = streamId;
              if (ref.isAbortRequested) {
                void window.snow.abortResponseStream(streamId);
              }
            }
          }
        );

        const ref = sessionsRefData.current.get(effectiveKey);
        if (ref) {
          ref.streamId = null;
        }

        if (response.conversationId) {
          if (effectiveKey === PENDING_SESSION_KEY) {
            migrateSession(PENDING_SESSION_KEY, response.conversationId);
            effectiveKey = response.conversationId;
            finalSessionKey = response.conversationId;
            // Only set active conversation on the first iteration when
            // migrating from pending. Subsequent tool iterations must NOT
            // override the active conversation — the user may have switched
            // to a different conversation while tools are running.
            if (activeConversationIdRef.current === undefined) {
              setActiveId(response.conversationId);
            }
          }
          // First message: immediately upsert the new conversation into
          // the list so it appears while AI is still responding.
          if (isFirstMessage) {
            void window.snow
              .getChatConversation(response.conversationId)
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
          }
        }

        if (response.tokenUsage) {
          updateSessionField(effectiveKey, "tokenUsage", response.tokenUsage);
        }

        // Auto-compaction check: when the active API config has
        // enableAutoCompress=true and the total token usage exceeds the
        // configured threshold, compact the context so the AI loop can
        // continue without hitting the context window limit.
        //
        // The compaction summary is appended as a new user message in the
        // database (handled by performCompaction). We then start a fresh
        // runAgentLoop iteration with the compacted context so the AI
        // picks up from the summary and continues working.
        if (
          response.tokenUsage &&
          effectiveKey !== PENDING_SESSION_KEY &&
          !sessionsRefData.current.get(effectiveKey)?.hasAutoCompacted
        ) {
          const apiConfig = activeApiConfigRef.current;
          if (apiConfig?.enableAutoCompress) {
            const thresholdTokens = calculateAutoCompressThresholdTokens(
              apiConfig.maxContextTokens,
              apiConfig.autoCompressThreshold
            );
            if (thresholdTokens != null && thresholdTokens > 0) {
              const totalTokens =
                response.tokenUsage.inputTokens +
                response.tokenUsage.outputTokens;
              if (totalTokens >= thresholdTokens) {
                const sessionRefForAuto =
                  sessionsRefData.current.get(effectiveKey);
                if (sessionRefForAuto) {
                  sessionRefForAuto.hasAutoCompacted = true;
                }

                const compactionSummary = await performCompactionRef.current(
                  effectiveKey,
                  options.model,
                  true
                );

                if (compactionSummary) {
                  if (
                    sessionsRefData.current.get(effectiveKey)?.isAbortRequested
                  ) {
                    return;
                  }

                  // Start a new agent loop iteration with the compacted
                  // context. The Rust backend uses conversationId to
                  // reconstruct context from the database, so the
                  // compaction summary message is automatically included.
                  const postCompactionAssistantId =
                    createMessageId("assistant");
                  const postCompactionAssistant: ChatConversationMessage = {
                    id: postCompactionAssistantId,
                    role: "assistant",
                    content: "",
                    timestamp: formatMessageTime(),
                    status: "sending",
                    model: options.model,
                  };
                  updateSessionMessages(effectiveKey, (currentMessages) => [
                    ...currentMessages,
                    postCompactionAssistant,
                  ]);
                  await runAgentLoop(
                    postCompactionAssistantId,
                    [{ role: "user", content: compactionSummary }],
                    response.conversationId
                  );
                  return;
                }

                // Compaction failed — reset the flag so it can retry later.
                if (sessionRefForAuto) {
                  sessionRefForAuto.hasAutoCompacted = false;
                }
              }
            }
          }
        }

        if (sessionsRefData.current.get(effectiveKey)?.isAbortRequested) {
          return;
        }

        // Parse tool calls from response. Mark the first call as running immediately
        // so expensive commands are visible before execution begins; later calls stay
        // pending until the sequential executor reaches them.
        const toolCalls = parseToolCalls(response.toolCallsJson);
        const visibleToolCalls = toolCalls;

        // Update assistant message with the persisted result. Failed responses
        // still migrate the session, but remain visible locally as an error.
        const responseFailed = response.status === "error";
        updateSessionMessages(effectiveKey, (currentMessages) =>
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
              status: responseFailed ? "error" : "sent",
              responseId: response.id || undefined,
              model: response.model || options.model,
              toolCalls:
                visibleToolCalls.length > 0 ? visibleToolCalls : undefined,
              isRetrying: false,
            };
          })
        );

        if (responseFailed) {
          return;
        }

        // If no tool calls, check for pending user messages before finishing.
        // This injects messages queued during AI streaming without waiting for
        // the entire outer handleSendMessage to complete.
        if (toolCalls.length === 0) {
          const pendingQueueNoTools =
            pendingQueueRef.current.get(effectiveKey) ?? [];
          if (pendingQueueNoTools.length > 0) {
            pendingQueueRef.current.delete(effectiveKey);
            const pendingText = pendingQueueNoTools
              .map((item) => item.text)
              .join("\n\n");
            setActivePendingMessages([]);

            const pendingUserMsg: ChatConversationMessage = {
              id: createMessageId("user"),
              role: "user",
              content: pendingText,
              timestamp: formatMessageTime(),
              status: "sent",
            };
            const nextAssistantId = createMessageId("assistant");
            const nextPendingAssistant: ChatConversationMessage = {
              id: nextAssistantId,
              role: "assistant",
              content: "",
              timestamp: formatMessageTime(),
              status: "sending",
              model: options.model,
            };
            updateSessionMessages(effectiveKey, (currentMessages) => [
              ...currentMessages,
              pendingUserMsg,
              nextPendingAssistant,
            ]);
            await runAgentLoop(
              nextAssistantId,
              [{ role: "user", content: pendingText }],
              response.conversationId
            );
          }
          return;
        }

        // A tool-call response must always be processed into tool results and
        // followed by another model request. The loop naturally finishes only
        // when a later response contains no tool calls, or when the user cancels.
        const authorizationDecisions = await requestToolAuthorizations(
          toolCalls,
          effectiveKey,
          sessionDirId
        );

        const toolResults: string[] = [];
        let userQuestionCancelled = false;
        for (let toolIndex = 0; toolIndex < toolCalls.length; toolIndex++) {
          const toolCall = toolCalls[toolIndex];
          if (sessionsRefData.current.get(effectiveKey)?.isAbortRequested) {
            return;
          }

          if (userQuestionCancelled) {
            const skippedResult = JSON.stringify({
              cancelled: true,
              skipped: true,
              reason: "Skipped because the user cancelled the question",
            });
            updateSessionMessages(effectiveKey, (currentMessages) =>
              currentMessages.map((currentMessage) => {
                if (currentMessage.id !== currentAssistantMessageId) {
                  return currentMessage;
                }

                return {
                  ...currentMessage,
                  toolCalls: updateFirstMatchingToolCall(
                    currentMessage.toolCalls,
                    toolCall,
                    ["pending", "running"],
                    (currentToolCall) => ({
                      ...currentToolCall,
                      status: "completed" as const,
                      result: skippedResult,
                    })
                  ),
                };
              })
            );
            const skippedIdentifier = toolCall.callId
              ? `${toolCall.name}#${toolCall.callId}`
              : toolCall.name;
            toolResults.push(`[Tool: ${skippedIdentifier}]\n${skippedResult}`);
            continue;
          }

          let result: string;
          const authorizationDecision = authorizationDecisions[toolIndex];
          if (authorizationDecision.status === "rejected") {
            const rejectionReason =
              authorizationDecision.reason || "User declined tool execution";
            result = JSON.stringify({
              success: false,
              error: "TOOL_EXECUTION_DENIED_BY_USER",
              message: `Tool execution rejected by user. Reason: ${rejectionReason}`,
              reason: rejectionReason,
              toolName: toolCall.name,
            });

            updateSessionMessages(effectiveKey, (currentMessages) =>
              currentMessages.map((currentMessage) => {
                if (currentMessage.id !== currentAssistantMessageId) {
                  return currentMessage;
                }

                return {
                  ...currentMessage,
                  toolCalls: updateFirstMatchingToolCall(
                    currentMessage.toolCalls,
                    toolCall,
                    ["pending", "running"],
                    (currentToolCall) => ({
                      ...currentToolCall,
                      status: "error" as const,
                      result,
                    })
                  ),
                };
              })
            );
          } else {
            const validationError = validateToolCall(toolCall);
            if (validationError) {
              result = validationError;
            } else {
              updateSessionMessages(effectiveKey, (currentMessages) =>
                currentMessages.map((currentMessage) => {
                  if (currentMessage.id !== currentAssistantMessageId) {
                    return currentMessage;
                  }

                  return {
                    ...currentMessage,
                    toolCalls: updateFirstMatchingToolCall(
                      currentMessage.toolCalls,
                      toolCall,
                      "pending",
                      (currentToolCall) => ({
                        ...currentToolCall,
                        status: "running" as const,
                      })
                    ),
                  };
                })
              );

              try {
                const checkpointIds =
                  sessionsRefData.current.get(effectiveKey)?.checkpointIds ??
                  [];

                // Force-override sessionId for todo-manage. Only add actions
                // receive responseId, because rollback tracking applies solely
                // to TODO items created by that action.
                let toolArgs = toolCall.arguments;
                if (
                  toolCall.name === "mcp__todo__todo-manage" &&
                  effectiveKey !== PENDING_SESSION_KEY
                ) {
                  try {
                    const parsedArgs = JSON.parse(toolArgs) as Record<
                      string,
                      unknown
                    >;
                    parsedArgs.sessionId = effectiveKey;
                    if (parsedArgs.action === "add" && response.id) {
                      parsedArgs.responseId = response.id;
                    }
                    toolArgs = JSON.stringify(parsedArgs);
                  } catch {
                    // If args are not valid JSON, let the tool fail naturally.
                  }
                }

                let sensitiveAuthorizationToken: string | undefined;
                if (
                  toolCall.name === "mcp__bash__terminal-execute" &&
                  authorizationDecision.status === "approved" &&
                  authorizationDecision.sensitiveCommandConfirmed === true
                ) {
                  const parsedArgs = JSON.parse(toolArgs) as Record<
                    string,
                    unknown
                  >;
                  if (typeof parsedArgs.command !== "string") {
                    throw new Error("Sensitive command argument is missing");
                  }
                  sensitiveAuthorizationToken =
                    await window.snow.issueSensitiveCommandAuthorization(
                      parsedArgs.command
                    );
                }

                const isUserQuestionTool =
                  toolCall.name === "mcp__user-interaction__askUserQuestion";
                if (isUserQuestionTool) {
                  userQuestionTargetRef.current.set(toolCall.interactionId, {
                    sessionKey: effectiveKey,
                    assistantMessageId: currentAssistantMessageId,
                  });
                }

                try {
                  if (
                    toolCall.name === "mcp__sub-agents__activate" &&
                    effectiveKey !== PENDING_SESSION_KEY
                  ) {
                    result = await executeSubAgentActivation(
                      toolArgs,
                      effectiveKey!,
                      sessionDirId ?? directoryId ?? ""
                    );
                  } else {
                    result = await window.snow.callMcpTool(
                      toolCall.name,
                      toolArgs,
                      sessionDirId,
                      checkpointIds,
                      checkpointIds.length > 0 ? directoryPath : undefined,
                      sensitiveAuthorizationToken,
                      (chunk) => {
                        if (!chunk.data) {
                          return;
                        }

                        updateSessionMessages(effectiveKey, (currentMessages) =>
                          currentMessages.map((currentMessage) => {
                            if (
                              currentMessage.id !== currentAssistantMessageId
                            ) {
                              return currentMessage;
                            }

                            return {
                              ...currentMessage,
                              toolCalls: updateFirstMatchingToolCall(
                                currentMessage.toolCalls,
                                toolCall,
                                ["pending", "running"],
                                (currentToolCall) => ({
                                  ...currentToolCall,
                                  streamingStdout:
                                    chunk.stream === "stdout"
                                      ? `${
                                          currentToolCall.streamingStdout ?? ""
                                        }${chunk.data}`
                                      : currentToolCall.streamingStdout,
                                  streamingStderr:
                                    chunk.stream === "stderr"
                                      ? `${
                                          currentToolCall.streamingStderr ?? ""
                                        }${chunk.data}`
                                      : currentToolCall.streamingStderr,
                                })
                              ),
                            };
                          })
                        );
                      },
                      toolCall.interactionId
                    );
                  }
                } finally {
                  if (isUserQuestionTool) {
                    userQuestionTargetRef.current.delete(
                      toolCall.interactionId
                    );
                  }
                }
              } catch (err) {
                result = JSON.stringify({ error: getErrorMessage(err) });
              }
            }

            updateSessionMessages(effectiveKey, (currentMessages) =>
              currentMessages.map((currentMessage) => {
                if (currentMessage.id !== currentAssistantMessageId) {
                  return currentMessage;
                }

                return {
                  ...currentMessage,
                  toolCalls: updateFirstMatchingToolCall(
                    currentMessage.toolCalls,
                    toolCall,
                    ["pending", "running"],
                    (currentToolCall) => ({
                      ...currentToolCall,
                      status: "completed" as const,
                      result,
                    })
                  ),
                };
              })
            );
          }

          if (
            toolCall.name === "mcp__user-interaction__askUserQuestion" &&
            isUserQuestionCancellationResult(result)
          ) {
            userQuestionCancelled = true;
          }

          const toolResultIdentifier = toolCall.callId
            ? `${toolCall.name}#${toolCall.callId}`
            : toolCall.name;
          const modelToolResult = formatMcpToolResultForModel(result);
          toolResults.push(
            `[Tool: ${toolResultIdentifier}]\n${modelToolResult}`
          );

          if (sessionsRefData.current.get(effectiveKey)?.isAbortRequested) {
            return;
          }
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

        updateSessionMessages(effectiveKey, (currentMessages) => [
          ...currentMessages,
          toolResultMessage,
        ]);

        if (userQuestionCancelled) {
          pendingQueueRef.current.delete(effectiveKey);
          setActivePendingMessages([]);
          if (response.conversationId) {
            await window.snow.appendToolMessage(
              response.conversationId,
              toolResultContent
            );
          }
          return;
        }

        // Continue the loop with tool results sent as role: "tool"
        // The Rust side (conversation.rs normalize_role) maps "tool" -> "user"
        // when sending to the AI API, but stores it as "tool" in the database.
        // Flush pending user messages before adding the next assistant placeholder so
        // they are sent in the next request as soon as the tool batch finishes.
        const pendingQueueForTools =
          pendingQueueRef.current.get(effectiveKey) ?? [];
        const nextMessages: {
          role: "user" | "assistant" | "system" | "developer" | "tool";
          content: string;
        }[] = [{ role: "tool", content: toolResultContent }];
        if (pendingQueueForTools.length > 0) {
          pendingQueueRef.current.delete(effectiveKey);
          const pendingText = pendingQueueForTools
            .map((item) => item.text)
            .join("\n\n");
          setActivePendingMessages([]);
          const pendingUserMsgForTools: ChatConversationMessage = {
            id: createMessageId("user"),
            role: "user",
            content: pendingText,
            timestamp: formatMessageTime(),
            status: "sent",
          };
          updateSessionMessages(effectiveKey, (currentMessages) => [
            ...currentMessages,
            pendingUserMsgForTools,
          ]);
          nextMessages.push({ role: "user", content: pendingText });
        }

        const newAssistantMessageId = createMessageId("assistant");
        const newPendingAssistant: ChatConversationMessage = {
          id: newAssistantMessageId,
          role: "assistant",
          content: "",
          timestamp: formatMessageTime(),
          status: "sending",
          model: options.model,
        };
        updateSessionMessages(effectiveKey, (currentMessages) => [
          ...currentMessages,
          newPendingAssistant,
        ]);

        await runAgentLoop(
          newAssistantMessageId,
          nextMessages,
          response.conversationId
        );
      };

      // Create a file-system checkpoint before the AI loop starts so that
      // rollback can restore the working directory to this pre-AI state.
      // The checkpoint is awaited before runAgentLoop to guarantee the AI
      // cannot modify files before the snapshot is captured.
      const initCheckpointAndRun = async (): Promise<void> => {
        let checkpointId: string | undefined;
        if (directoryPath && !directoryPath.startsWith("ssh://")) {
          try {
            checkpointId = await window.snow.createCheckpoint(directoryPath);
            const ref = sessionsRefData.current.get(sessionKey);
            if (ref) {
              ref.checkpointIds = [...ref.checkpointIds, checkpointId];
            }
            updateSessionMessages(sessionKey, (currentMessages) =>
              currentMessages.map((m) =>
                m.id === userMessage.id ? { ...m, checkpointId } : m
              )
            );
          } catch {
            // Best effort — continue without a checkpoint
          }
        }
        await runAgentLoop(
          assistantMessageId,
          [{ role: "user", content: trimmed }],
          sessionKey === PENDING_SESSION_KEY ? undefined : sessionKey,
          checkpointId
        );
      };

      void initCheckpointAndRun()
        .catch((error: unknown) => {
          updateSessionField(finalSessionKey, "isStreaming", false);
          const ref = sessionsRefData.current.get(finalSessionKey);
          if (ref) {
            ref.streamId = null;
          }
          updateSessionMessages(finalSessionKey, (currentMessages) =>
            currentMessages.map((currentMessage) =>
              currentMessage.status === "sending"
                ? {
                    ...currentMessage,
                    content: getErrorMessage(error),
                    timestamp: formatMessageTime(),
                    status: "error",
                    isRetrying: false,
                  }
                : currentMessage
            )
          );
        })
        .finally(() => {
          const ref = sessionsRefData.current.get(finalSessionKey);
          if (ref) {
            ref.isSending = false;
          }
          updateSessionField(finalSessionKey, "isStreaming", false);
          updateSessionField(finalSessionKey, "isAborting", false);
          removeStreamingId(finalSessionKey);

          // Flush pending messages queued while this session was busy.
          const pendingQueue =
            pendingQueueRef.current.get(finalSessionKey) ?? [];
          if (!ref?.isAbortRequested && pendingQueue.length > 0) {
            pendingQueueRef.current.delete(finalSessionKey);
            const combined = pendingQueue.map((item) => item.text).join("\n\n");
            const lastOptions =
              pendingQueue[pendingQueue.length - 1]?.options ?? {};
            setActivePendingMessages([]);
            handleSendMessageRef.current(combined, lastOptions);
          }

          // If this is a background conversation (not the active one),
          // mark it as completed so the sidebar shows a dot indicator.
          if (
            finalSessionKey !== PENDING_SESSION_KEY &&
            finalSessionKey !== activeConversationIdRef.current
          ) {
            updateSessionField(finalSessionKey, "hasNewContent", true);
            setCompletedConversationIds((prev) => {
              if (prev.has(finalSessionKey)) return prev;
              const next = new Set(prev);
              next.add(finalSessionKey);
              return next;
            });
          }

          // First message: generate summary asynchronously, then upsert
          // again to update the conversation title.
          if (isFirstMessage && finalSessionKey !== PENDING_SESSION_KEY) {
            const currentId = finalSessionKey;

            void window.snow
              .generateConversationSummary(currentId)
              .then((generatedSummary) => {
                if (generatedSummary) {
                  updateSessionField(currentId, "summary", generatedSummary);
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
    [
      directoryId,
      directoryPath,
      ensureSession,
      updateSessionMessages,
      updateSessionField,
      migrateSession,
      addStreamingId,
      removeStreamingId,
      setActiveId,
    ]
  );

  // Keep the ref current so the pending-flush closure always calls the latest version.
  handleSendMessageRef.current = handleSendMessage;

  /**
   * Core compaction logic shared by manual /compact and automatic threshold
   * triggered compaction. Sends a "context handoff" request with
   * contextCompaction=true, then appends the generated summary as a new user
   * message so subsequent AI requests use the compacted context.
   *
   * Returns the compaction summary content on success, or null on failure.
   */
  const performCompaction = useCallback(
    async (
      conversationId: string,
      model?: string,
      isAuto = false
    ): Promise<string | null> => {
      const sessionRef = sessionsRefData.current.get(conversationId);
      if (sessionRef) {
        sessionRef.isSending = true;
        sessionRef.isAbortRequested = false;
      }
      setCompactionPreview("");
      setCompactionError(null);
      setIsCompacting(true);

      try {
        const response = await window.snow.createResponseStream(
          {
            messages: [{ role: "user", content: "context handoff" }],
            model,
            conversationId,
            directoryId: sessionRef?.directoryId ?? directoryId,
            contextCompaction: true,
          },
          (chunk) => {
            if (chunk.retrying) {
              return;
            }
            setCompactionPreview(
              (current) => chunk.content || `${current}${chunk.contentDelta}`
            );
          },
          (streamId) => {
            if (sessionRef) {
              sessionRef.streamId = streamId;
            }
          }
        );

        const content = response.content.trim();
        if (!content) {
          throw new Error("Context handoff is empty");
        }

        if (response.tokenUsage) {
          updateSessionField(conversationId, "tokenUsage", response.tokenUsage);
        }

        const compactionMessage: ChatConversationMessage = {
          id: response.id || createMessageId("user"),
          role: "user",
          content,
          timestamp: formatMessageTime(),
          status: "sent",
          responseId: response.id || undefined,
          model: response.model || model,
          isContextCompaction: true,
        };
        updateSessionMessages(conversationId, (currentMessages) => [
          ...currentMessages,
          compactionMessage,
        ]);
        const latestRecords = await window.snow.listChatMessages(
          conversationId
        );
        updateSessionField(conversationId, "messageRecords", latestRecords);

        return content;
      } catch (error) {
        if (!isAuto) {
          setCompactionError(
            error instanceof Error ? error.message : "Failed to compact context"
          );
        }
        return null;
      } finally {
        if (sessionRef) {
          sessionRef.isSending = false;
          sessionRef.streamId = null;
        }
        setIsCompacting(false);
        setCompactionPreview("");

        // For manual compaction, flush pending messages after completion.
        // Auto-compaction runs inside runAgentLoop so the loop itself
        // continues — no pending flush needed.
        if (!isAuto) {
          const pendingQueue =
            pendingQueueRef.current.get(conversationId) ?? [];
          if (!sessionRef?.isAbortRequested && pendingQueue.length > 0) {
            pendingQueueRef.current.delete(conversationId);
            const combined = pendingQueue.map((item) => item.text).join("\n\n");
            const lastOptions =
              pendingQueue[pendingQueue.length - 1]?.options ?? {};
            setActivePendingMessages([]);
            handleSendMessageRef.current(combined, lastOptions);
          }
        }
      }
    },
    [directoryId, updateSessionField, updateSessionMessages]
  );

  // Keep the ref current so runAgentLoop (defined inside handleSendMessage)
  // can call the latest performCompaction without stale closures.
  performCompactionRef.current = performCompaction;

  const compactConversation = useCallback(
    async (model?: string): Promise<void> => {
      const conversationId = activeConversationIdRef.current;
      if (
        !conversationId ||
        sessionsRefData.current.get(conversationId)?.isSending
      ) {
        return;
      }

      await performCompaction(conversationId, model, false);
    },
    [performCompaction]
  );

  const withdrawPendingMessage = useCallback((index: number): string | null => {
    const sessionKey = activeConversationIdRef.current ?? PENDING_SESSION_KEY;
    const queue = pendingQueueRef.current.get(sessionKey);
    if (!queue || index < 0 || index >= queue.length) {
      return null;
    }

    const [removed] = queue.splice(index, 1);
    if (queue.length === 0) {
      pendingQueueRef.current.delete(sessionKey);
    }
    setActivePendingMessages(queue.map((item) => item.text));
    return removed?.text ?? null;
  }, []);

  const handleSelectConversation = useCallback(
    async (
      conversationId: string,
      title?: string,
      conversationTokenUsage?: TokenUsage | null,
      conversationDirId?: string
    ): Promise<void> => {
      const trimmedId = conversationId.trim();
      if (!trimmedId) {
        return;
      }
      const selectionRequestId = ++selectionRequestIdRef.current;
      const cachedSession = sessionsRef.current[trimmedId];
      const hasLoadedCachedHistory =
        sessionsRefData.current.has(trimmedId) &&
        cachedSession?.isInitialHistoryLoaded === true;

      if (
        trimmedId === activeConversationIdRef.current &&
        hasLoadedCachedHistory
      ) {
        setIsLoadingInitialHistory(false);
        return;
      }

      setIsLoadingInitialHistory(true);
      setActiveId(trimmedId);

      if (hasLoadedCachedHistory) {
        updateSessionField(trimmedId, "hasNewContent", false);
        setCompletedConversationIds((prev) => {
          if (!prev.has(trimmedId)) return prev;
          const next = new Set(prev);
          next.delete(trimmedId);
          return next;
        });

        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => resolve());
          });
        });
        if (selectionRequestId === selectionRequestIdRef.current) {
          setIsLoadingInitialHistory(false);
        }
        return;
      }

      const nextTitle = title?.trim() ?? "";

      try {
        const [page, conversationRecord] = await Promise.all([
          window.snow.listChatMessagesPaginated(
            trimmedId,
            "",
            CHAT_MESSAGE_PAGE_SIZE
          ),
          window.snow.getChatConversation(trimmedId),
        ]);

        if (selectionRequestId !== selectionRequestIdRef.current) {
          return;
        }

        const checkpointIds = Array.from(
          new Set(
            page.items
              .filter((record) => record.role === "user" && record.checkpointId)
              .map((record) => record.checkpointId)
          )
        );

        sessionsRefData.current.set(trimmedId, {
          streamId: null,
          isSending: false,
          isAbortRequested: false,
          directoryId: conversationDirId,
          checkpointIds,
          hasAutoCompacted: false,
        });
        setSessions((prev) => ({
          ...prev,
          [trimmedId]: {
            messages: buildConversationMessages(page.items),
            messageRecords: page.items,
            summary: nextTitle,
            isStreaming: false,
            isAborting: false,
            isLoadingOlderMessages: false,
            hasMoreMessages: page.hasMore,
            isInitialHistoryLoaded: true,
            tokenUsage: conversationTokenUsage ?? null,
            directoryId: conversationDirId,
            hasNewContent: false,
            forkedFromConversationId:
              conversationRecord?.forkedFromConversationId || undefined,
            forkMessageCount: conversationRecord?.forkMessageCount || undefined,
          },
        }));
      } catch {
        // 加载历史消息失败时静默处理，不阻断交互
      } finally {
        if (selectionRequestId === selectionRequestIdRef.current) {
          setIsLoadingInitialHistory(false);
        }
      }
    },
    [setActiveId, updateSessionField]
  );

  const loadOlderMessages = useCallback(async (): Promise<void> => {
    const conversationId = activeConversationIdRef.current;
    if (!conversationId) {
      return;
    }

    const session = sessionsRef.current[conversationId];
    const beforeMessageId = session?.messageRecords[0]?.id;
    if (
      !session ||
      !beforeMessageId ||
      !session.hasMoreMessages ||
      loadingOlderConversationIdsRef.current.has(conversationId)
    ) {
      return;
    }

    loadingOlderConversationIdsRef.current.add(conversationId);
    updateSessionField(conversationId, "isLoadingOlderMessages", true);

    try {
      const page = await window.snow.listChatMessagesPaginated(
        conversationId,
        beforeMessageId,
        CHAT_MESSAGE_PAGE_SIZE
      );
      const currentSession = sessionsRef.current[conversationId];
      if (!currentSession) {
        return;
      }

      const existingIds = new Set(
        currentSession.messageRecords.map((record) => record.id)
      );
      const olderRecords = page.items.filter(
        (record) => !existingIds.has(record.id)
      );
      const combinedRecords = [
        ...olderRecords,
        ...currentSession.messageRecords,
      ];
      const persistedIds = new Set(
        currentSession.messageRecords.map((record) => record.id)
      );
      const transientMessages = currentSession.messages.filter(
        (message) => !persistedIds.has(message.id)
      );

      setSessions((prev) => {
        const latestSession = prev[conversationId];
        if (!latestSession) {
          return prev;
        }

        return {
          ...prev,
          [conversationId]: {
            ...latestSession,
            messages: [
              ...buildConversationMessages(combinedRecords),
              ...transientMessages,
            ],
            messageRecords: combinedRecords,
            isLoadingOlderMessages: false,
            hasMoreMessages: page.hasMore,
          },
        };
      });

      const refData = sessionsRefData.current.get(conversationId);
      if (refData) {
        refData.checkpointIds = Array.from(
          new Set(
            combinedRecords
              .filter((record) => record.role === "user" && record.checkpointId)
              .map((record) => record.checkpointId)
          )
        );
      }
    } catch {
      updateSessionField(conversationId, "isLoadingOlderMessages", false);
    } finally {
      loadingOlderConversationIdsRef.current.delete(conversationId);
    }
  }, [updateSessionField]);

  const handleNewChat = useCallback((): void => {
    selectionRequestIdRef.current += 1;
    setIsLoadingInitialHistory(false);
    // Clear stale pending session if not actively streaming
    const pendingRef = sessionsRefData.current.get(PENDING_SESSION_KEY);
    if (pendingRef && !pendingRef.isSending) {
      deleteCheckpoints(pendingRef.checkpointIds);
      sessionsRefData.current.delete(PENDING_SESSION_KEY);
      setSessions((prev) => {
        const next = { ...prev };
        delete next[PENDING_SESSION_KEY];
        return next;
      });
    }
    setActiveId(undefined);
  }, [setActiveId]);

  const handleAbort = useCallback((): void => {
    const key = activeConversationIdRef.current ?? PENDING_SESSION_KEY;
    const ref = sessionsRefData.current.get(key);
    if (!ref?.isSending || ref.isAbortRequested) {
      return;
    }

    rejectAllToolAuthorizations();
    rejectPendingUserQuestions(key);
    ref.isAbortRequested = true;
    updateSessionMessages(key, (currentMessages) =>
      currentMessages.map((message) => ({
        ...message,
        status: message.status === "sending" ? "sent" : message.status,
        isRetrying: message.status === "sending" ? false : message.isRetrying,
        toolCalls: message.toolCalls?.map((toolCall) =>
          toolCall.status === "running" || toolCall.status === "pending"
            ? {
                ...toolCall,
                status: "error",
                result: toolCall.result ?? "Interrupted by user",
              }
            : toolCall
        ),
      }))
    );
    updateSessionField(key, "isStreaming", false);
    updateSessionField(key, "isAborting", false);
    removeStreamingId(key);

    if (ref.streamId) {
      void window.snow.abortResponseStream(ref.streamId);
    }
  }, [
    removeStreamingId,
    rejectAllToolAuthorizations,
    rejectPendingUserQuestions,
    updateSessionMessages,
    updateSessionField,
  ]);

  const abortConversation = useCallback(
    (conversationId: string): void => {
      const ref = sessionsRefData.current.get(conversationId);
      rejectAllToolAuthorizations();
      rejectPendingUserQuestions(conversationId);
      if (ref?.streamId) {
        void window.snow.abortResponseStream(ref.streamId);
        ref.streamId = null;
      }
      if (ref) {
        ref.isSending = false;
      }
      updateSessionField(conversationId, "isStreaming", false);
      updateSessionField(conversationId, "isAborting", false);
      removeStreamingId(conversationId);
      // Clean up session state and incremental checkpoint storage.
      if (ref) {
        deleteCheckpoints(ref.checkpointIds);
      }
      sessionsRefData.current.delete(conversationId);
      setSessions((prev) => {
        const next = { ...prev };
        delete next[conversationId];
        return next;
      });
    },
    [
      removeStreamingId,
      rejectAllToolAuthorizations,
      rejectPendingUserQuestions,
      updateSessionField,
    ]
  );

  const refreshConversations = useCallback((): void => {
    setConversationVersion((version) => version + 1);
  }, []);

  const handleForkConversation = useCallback(
    async (conversationId: string, upToResponseId: string): Promise<void> => {
      const trimmedId = conversationId.trim();
      if (!trimmedId) return;

      try {
        const forkedRecord = await window.snow.forkConversation(
          trimmedId,
          upToResponseId.trim()
        );

        // Refresh sidebar list so the new forked conversation appears
        setUpsertedConversation({
          record: forkedRecord,
          timestamp: Date.now(),
        });

        // Switch to the new forked conversation
        await handleSelectConversation(
          forkedRecord.conversationId,
          forkedRecord.summary || forkedRecord.title,
          {
            inputTokens: forkedRecord.inputTokens,
            outputTokens: forkedRecord.outputTokens,
            cacheCreationInputTokens: forkedRecord.cacheCreationInputTokens,
            cacheReadInputTokens: forkedRecord.cacheReadInputTokens,
          },
          forkedRecord.directoryId
        );
      } catch {
        // Fork failure should not block the UI
      }
    },
    [handleSelectConversation]
  );

  const clearDraftToRestore = useCallback((): void => {
    setDraftToRestore(null);
  }, []);

  const handleRollback = useCallback(
    (messageId: string): void => {
      const key = activeConversationIdRef.current ?? PENDING_SESSION_KEY;

      // Abort any in-flight stream before rolling back.
      const ref = sessionsRefData.current.get(key);
      if (ref?.streamId) {
        void window.snow.abortResponseStream(ref.streamId);
        ref.streamId = null;
      }
      if (ref) {
        ref.isSending = false;
      }
      updateSessionField(key, "isStreaming", false);
      updateSessionField(key, "isAborting", false);
      removeStreamingId(key);

      const session = sessionsRef.current[key];
      if (!session) {
        return;
      }

      const messages = session.messages;
      const targetIndex = messages.findIndex((m) => m.id === messageId);
      if (targetIndex === -1) {
        return;
      }

      const targetMessage = messages[targetIndex];
      const messageContent = targetMessage.content;
      const checkpointId = targetMessage.checkpointId;
      const convId = key !== PENDING_SESSION_KEY ? key : undefined;

      // Delete the entire conversation only when this is the true first user
      // message in the complete history. A compaction boundary and the first item
      // in a paginated window must always use range truncation instead.
      const hasUserMessageBefore = messages
        .slice(0, targetIndex)
        .some((m) => m.role === "user");
      const isFirstMessage =
        !targetMessage.isContextCompaction &&
        !session.hasMoreMessages &&
        !hasUserMessageBefore;

      // Normal user messages roll back from their following assistant response.
      // A compaction boundary is persisted as a user message with its own response id,
      // so rolling back that boundary must target the boundary row itself.
      let responseId = targetMessage.isContextCompaction
        ? targetMessage.responseId
        : undefined;
      if (!responseId) {
        for (let i = targetIndex + 1; i < messages.length; i++) {
          if (messages[i].role === "assistant" && messages[i].responseId) {
            responseId = messages[i].responseId;
            break;
          }
        }
      }

      // Compute file changes for the confirmation dialog. This is async but
      // we set the preview state once the diff is ready.
      const computeAndPreview = async (): Promise<void> => {
        let changes: CheckpointFileChange[] = [];
        if (
          checkpointId &&
          directoryPath &&
          !directoryPath.startsWith("ssh://")
        ) {
          try {
            changes = await window.snow.listCheckpointChanges(
              checkpointId,
              directoryPath
            );
          } catch {
            // Best effort — show dialog without changes on error
          }
        }

        // Fetch TODO items that will be deleted alongside the rollback.
        let todoItems: RollbackTodoItem[] = [];
        if (convId && responseId) {
          try {
            const todoJson = await window.snow.listTodosForRollback(
              convId,
              responseId
            );
            const parsed = JSON.parse(todoJson) as unknown;
            if (Array.isArray(parsed)) {
              todoItems = parsed
                .filter(
                  (item): item is Record<string, unknown> =>
                    typeof item === "object" && item !== null
                )
                .map((item) => ({
                  id: typeof item.id === "string" ? item.id : "",
                  content: typeof item.content === "string" ? item.content : "",
                  status:
                    typeof item.status === "string" ? item.status : "pending",
                }))
                .filter((item) => item.id);
            }
          } catch {
            // Best effort — show empty on error
          }
        }

        setRollbackPreview({
          messageId,
          messageContent,
          changes,
          checkpointId,
          workDir: directoryPath,
          convId,
          responseId,
          isFirstMessage,
          isContextCompaction: targetMessage.isContextCompaction === true,
          todoItems,
        });
      };

      void computeAndPreview();
    },
    [directoryPath, updateSessionField, removeStreamingId]
  );

  const confirmRollback = useCallback((): void => {
    const preview = rollbackPreview;
    if (!preview) {
      return;
    }

    const key = activeConversationIdRef.current ?? PENDING_SESSION_KEY;
    const {
      messageId,
      messageContent,
      checkpointId,
      convId,
      responseId,
      isFirstMessage,
      isContextCompaction,
    } = preview;

    updateSessionMessages(key, (currentMessages) => {
      const targetIndex = currentMessages.findIndex(
        (message) => message.id === messageId
      );
      return targetIndex === -1
        ? currentMessages
        : currentMessages.slice(0, targetIndex);
    });

    if (checkpointId && directoryPath && !directoryPath.startsWith("ssh://")) {
      const sessionRef = sessionsRefData.current.get(key);
      const checkpointIndex =
        sessionRef?.checkpointIds.indexOf(checkpointId) ?? -1;
      const discardedCheckpointIds =
        sessionRef && checkpointIndex >= 0
          ? sessionRef.checkpointIds.slice(checkpointIndex)
          : [checkpointId];
      if (sessionRef && checkpointIndex >= 0) {
        sessionRef.checkpointIds = sessionRef.checkpointIds.slice(
          0,
          checkpointIndex
        );
      }
      void window.snow
        .restoreCheckpoint(checkpointId, directoryPath)
        .then(() => {
          deleteCheckpoints(discardedCheckpointIds);
        })
        .catch(() => {
          if (
            sessionRef &&
            checkpointIndex >= 0 &&
            !sessionRef.checkpointIds.includes(checkpointId)
          ) {
            sessionRef.checkpointIds = [
              ...sessionRef.checkpointIds,
              ...discardedCheckpointIds,
            ];
          }
        });
    }

    if (isFirstMessage && !isContextCompaction && convId) {
      void window.snow
        .deleteConversation(convId)
        .then(() => {
          refreshConversations();
        })
        .catch(() => {
          // Best effort
        });
      sessionsRefData.current.delete(key);
      setSessions((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setActiveId(undefined);
    } else if (convId && responseId) {
      void window.snow.truncateConversation(convId, responseId).catch(() => {
        // Best effort — database persistence must not block the UI refresh.
      });
    }

    if (!isContextCompaction) {
      setDraftToRestore(messageContent);
    }
    setRollbackPreview(null);
  }, [
    rollbackPreview,
    directoryPath,
    updateSessionMessages,
    refreshConversations,
    setActiveId,
  ]);

  const cancelRollback = useCallback((): void => {
    setRollbackPreview(null);
  }, []);

  const activeKey = activeConversationId ?? PENDING_SESSION_KEY;
  const activeSession = sessions[activeKey];

  return {
    messages: activeSession?.messages ?? [],
    summary: activeSession?.summary ?? "",
    conversationVersion,
    upsertedConversation,
    subAgentSessionEvent,
    activeConversationId,
    conversationDirectoryId: activeSession?.directoryId,
    tokenUsage: activeSession?.tokenUsage ?? null,
    forkedFromConversationId: activeSession?.forkedFromConversationId,
    forkMessageCount: activeSession?.forkMessageCount,
    streamingConversationIds,
    completedConversationIds,
    isLoadingOlderMessages: activeSession?.isLoadingOlderMessages ?? false,
    hasMoreMessages: activeSession?.hasMoreMessages ?? false,
    isInitialHistoryLoaded: activeSession?.isInitialHistoryLoaded ?? false,
    isLoadingInitialHistory,
    loadOlderMessages,
    handleSendMessage,
    pendingMessages: activePendingMessages,
    withdrawPendingMessage,
    compactConversation,
    compactionPreview,
    compactionError,
    isCompacting,
    handleSelectConversation,
    handleNewChat,
    refreshConversations,
    isStreaming: activeSession?.isStreaming ?? false,
    isAborting: activeSession?.isAborting ?? false,
    handleAbort,
    abortConversation,
    handleForkConversation,
    draftToRestore,
    clearDraftToRestore,
    handleRollback,
    rollbackPreview,
    confirmRollback,
    cancelRollback,
    yoloMode,
    isUpdatingYoloMode,
    setYoloMode,
    refreshYoloMode,
    pendingToolAuthorizations,
    approveToolAuthorization: (toolCall) =>
      settleToolAuthorization(toolCall, {
        status: "approved",
        sensitiveCommandConfirmed:
          (toolCall.sensitiveCommandMatches?.length ?? 0) > 0,
      }),
    approveToolAuthorizationAlways,
    rejectToolAuthorization: (toolCall, reason) =>
      settleToolAuthorization(toolCall, {
        status: "rejected",
        reason: reason.trim() || "User declined tool execution",
      }),
    answerUserQuestion,
    cancelUserQuestion,
  };
};
