import type { ChatInputSendOptions } from "../../chatInput/types";
import type {
  ApiConfigRecord,
  ChatConversationRecord,
  ChatMessageRecord,
  CheckpointFileChange,
  TokenUsage,
  UserQuestionRequest,
} from "../../../../../preload";
import type { Dispatch, SetStateAction } from "react";

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

export type UpsertedConversation = {
  record: ChatConversationRecord;
  timestamp: number;
};

export type SubAgentSessionEvent = {
  parentConversationId: string;
  conversationId: string;
  agentId: string;
  agentName: string;
  status: "running" | "completed" | "failed" | "cancelled";
  timestamp: number;
};

export type ConversationSessionState = {
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
  /** Real-time token probe for the current agent-loop iteration.
   *  Reset to 0 when a new iteration starts; updated on every streaming
   *  chunk (content, thinking, and tool-call arguments) by the Rust
   *  backend via `ResponsesApiStreamChunk.streamTokenCount`. */
  streamTokenCount: number;
  /** Elapsed milliseconds since the streaming request started.
   *  Updated on every streaming chunk by the Rust backend. */
  streamElapsedMs: number;
  /** Time to first token in milliseconds. 0 until the first content
   *  or thinking delta arrives, then frozen for the iteration. */
  streamTtftMs: number;
};

export type ConversationSessionRef = {
  streamId: string | null;
  isSending: boolean;
  isAbortRequested: boolean;
  directoryId?: string;
  checkpointIds: string[];
  hasAutoCompacted: boolean;
};

export type RollbackTodoItem = {
  id: string;
  content: string;
  status: string;
};

export type RollbackMode = "conversation-only" | "conversation-and-files";

export type RollbackPreview = {
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

export type ToolAuthorizationDecision =
  | { status: "approved"; sensitiveCommandConfirmed?: boolean }
  | { status: "rejected"; reason: string };

export type PendingToolAuthorization = {
  toolCall: ToolCallInfo;
  resolve: (decision: ToolAuthorizationDecision) => void;
};

export type PendingUserQuestion = {
  interactionId: string;
  resolve: (resultJson: string) => void;
  reject: (error: Error) => void;
};

export type UserQuestionTarget = {
  sessionKey: string;
  assistantMessageId: string;
};

export type PendingQueueItem = {
  text: string;
  options: ChatInputSendOptions;
};

/** Ref value type compatible with React's MutableRefObject */
export type RefValue<T> = { current: T };

/** Shared context passed to all sub-hooks */
export type ConversationContextValue = {
  // Params
  directoryId?: string;
  directoryPath?: string;

  // State values
  sessions: Record<string, ConversationSessionState>;
  activeConversationId: string | undefined;
  conversationVersion: number;
  upsertedConversation: UpsertedConversation | null;
  subAgentSessionEvent: SubAgentSessionEvent | null;
  streamingConversationIds: Set<string>;
  completedConversationIds: Set<string>;
  isLoadingInitialHistory: boolean;
  draftToRestore: string | null;
  rollbackPreview: RollbackPreview | null;
  /** True when the user explicitly clicked "New chat" while a pending or
   *  active session was still streaming. The UI should show the empty
   *  greeting instead of falling back to the pending session, and the
   *  agent loop must NOT auto-switch back to the migrated conversation. */
  newChatRequested: boolean;
  yoloMode: boolean;
  isUpdatingYoloMode: boolean;
  planMode: boolean;
  isUpdatingPlanMode: boolean;
  pendingToolAuthorizations: ToolCallInfo[];
  activePendingMessages: string[];
  compactionPreview: string;
  compactionError: string | null;
  isCompacting: boolean;

  // Refs
  sessionsRefData: RefValue<Map<string, ConversationSessionRef>>;
  activeConversationIdRef: RefValue<string | undefined>;
  selectionRequestIdRef: RefValue<number>;
  loadingOlderConversationIdsRef: RefValue<Set<string>>;
  sessionsRef: RefValue<Record<string, ConversationSessionState>>;
  /** Ref mirror of newChatRequested for use inside async agent-loop closures
   *  that cannot read the latest React state directly. */
  newChatRequestedRef: RefValue<boolean>;
  pendingQueueRef: RefValue<Map<string, PendingQueueItem[]>>;
  handleSendMessageRef: RefValue<
    (message: string, options: ChatInputSendOptions) => void
  >;
  performCompactionRef: RefValue<
    (
      conversationId: string,
      model?: string,
      isAuto?: boolean
    ) => Promise<string | null>
  >;
  yoloModeRef: RefValue<boolean>;
  planModeRef: RefValue<boolean>;
  alwaysApprovedToolsRef: RefValue<Set<string>>;
  pendingToolAuthorizationRef: RefValue<Map<string, PendingToolAuthorization>>;
  pendingUserQuestionRef: RefValue<Map<string, PendingUserQuestion>>;
  userQuestionTargetRef: RefValue<Map<string, UserQuestionTarget>>;
  activeApiConfigRef: RefValue<ApiConfigRecord | null>;

  // State setters
  setSessions: Dispatch<
    SetStateAction<Record<string, ConversationSessionState>>
  >;
  setActiveConversationId: Dispatch<SetStateAction<string | undefined>>;
  setConversationVersion: Dispatch<SetStateAction<number>>;
  setUpsertedConversation: Dispatch<
    SetStateAction<UpsertedConversation | null>
  >;
  setSubAgentSessionEvent: Dispatch<
    SetStateAction<SubAgentSessionEvent | null>
  >;
  setStreamingConversationIds: Dispatch<SetStateAction<Set<string>>>;
  setCompletedConversationIds: Dispatch<SetStateAction<Set<string>>>;
  setIsLoadingInitialHistory: Dispatch<SetStateAction<boolean>>;
  setDraftToRestore: Dispatch<SetStateAction<string | null>>;
  setRollbackPreview: Dispatch<SetStateAction<RollbackPreview | null>>;
  setNewChatRequested: Dispatch<SetStateAction<boolean>>;
  setYoloModeState: Dispatch<SetStateAction<boolean>>;
  setIsUpdatingYoloMode: Dispatch<SetStateAction<boolean>>;
  setPlanModeState: Dispatch<SetStateAction<boolean>>;
  setIsUpdatingPlanMode: Dispatch<SetStateAction<boolean>>;
  setPendingToolAuthorizations: Dispatch<SetStateAction<ToolCallInfo[]>>;
  setActivePendingMessages: Dispatch<SetStateAction<string[]>>;
  setCompactionPreview: Dispatch<SetStateAction<string>>;
  setCompactionError: Dispatch<SetStateAction<string | null>>;
  setIsCompacting: Dispatch<SetStateAction<boolean>>;

  // Basic session callbacks
  setActiveId: (id: string | undefined) => void;
  ensureSession: (key: string, dirId?: string) => void;
  updateSessionMessages: (
    key: string,
    updater: (messages: ChatConversationMessage[]) => ChatConversationMessage[]
  ) => void;
  updateSessionField: <K extends keyof ConversationSessionState>(
    key: string,
    field: K,
    value: ConversationSessionState[K]
  ) => void;
  migrateSession: (oldKey: string, newKey: string) => void;
  addStreamingId: (id: string) => void;
  removeStreamingId: (id: string) => void;

  // 通知系统：AI 流程结束 / 敏感命令拦截 / 用户交互确认时触发系统通知
  notifyAiComplete: (conversationTitle?: string) => void;
  notifySensitiveCommandIntercepted: (toolName: string) => void;
  notifyUserInteractionRequired: (reason: string) => void;
};

export type UseChatConversationResult = {
  messages: ChatConversationMessage[];
  summary: string;
  conversationVersion: number;
  upsertedConversation: UpsertedConversation | null;
  subAgentSessionEvent: SubAgentSessionEvent | null;
  /** All conversation sessions, keyed by conversation id. Used by tool-call
   *  UIs (e.g. sub-agent activation) to inspect the live state of other
   *  sessions such as streaming sub-agent conversations. */
  sessions: Record<string, ConversationSessionState>;
  activeConversationId: string | undefined;
  conversationDirectoryId: string | undefined;
  tokenUsage: TokenUsage | null;
  /** Real-time token probe for the current agent-loop iteration.
   *  Updated on every streaming chunk by the Rust backend; reset to 0
   *  when a new iteration starts. */
  streamTokenCount: number;
  /** Elapsed milliseconds since the streaming request started. */
  streamElapsedMs: number;
  /** Time to first token in milliseconds. */
  streamTtftMs: number;
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
  confirmRollback: (mode: RollbackMode) => void;
  cancelRollback: () => void;
  yoloMode: boolean;
  isUpdatingYoloMode: boolean;
  setYoloMode: (enabled: boolean) => Promise<void>;
  refreshYoloMode: () => Promise<boolean>;
  planMode: boolean;
  isUpdatingPlanMode: boolean;
  setPlanMode: (enabled: boolean) => Promise<void>;
  refreshPlanMode: () => Promise<boolean>;
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

// Re-export preload types for convenience
export type {
  ApiConfigRecord,
  ChatConversationRecord,
  ChatMessageRecord,
  CheckpointFileChange,
  TokenUsage,
  UserQuestionRequest,
};

export const PENDING_SESSION_KEY = "__pending__";
export const CHAT_MESSAGE_PAGE_SIZE = 10;
