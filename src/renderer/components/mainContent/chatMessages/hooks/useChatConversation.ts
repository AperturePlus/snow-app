import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatInputSendOptions } from "../../chatInput/types";
import type { ApiConfigRecord } from "../../../../../preload";
import { calculateAutoCompressThresholdTokens } from "../../../sidebar/apiSettings/autoCompressThreshold";

import type {
  ConversationContextValue,
  UseChatConversationResult,
} from "../utils/conversationTypes";
import { PENDING_SESSION_KEY } from "../utils/conversationTypes";

import { useConversationSession } from "./useConversationSession";
import { useToolAuthorization } from "./useToolAuthorization";
import { useUserQuestion } from "./useUserQuestion";
import { useCompaction } from "./useCompaction";
import { useRollback } from "./useRollback";
import { useAgentLoop } from "./useAgentLoop";
import { useConversationManagement } from "./useConversationManagement";

export const useChatConversation = (
  directoryId?: string,
  directoryPath?: string
): UseChatConversationResult => {
  // --- State ---
  const [sessions, setSessions] = useState<
    Record<string, ConversationContextValue["sessions"][string]>
  >({});
  const [activeConversationId, setActiveConversationId] = useState<
    string | undefined
  >(undefined);
  const [conversationVersion, setConversationVersion] = useState(0);
  const [upsertedConversation, setUpsertedConversation] =
    useState<ConversationContextValue["upsertedConversation"]>(null);
  const [subAgentSessionEvent, setSubAgentSessionEvent] =
    useState<ConversationContextValue["subAgentSessionEvent"]>(null);
  const [streamingConversationIds, setStreamingConversationIds] = useState<
    Set<string>
  >(new Set());
  const [completedConversationIds, setCompletedConversationIds] = useState<
    Set<string>
  >(new Set());
  const [isLoadingInitialHistory, setIsLoadingInitialHistory] = useState(false);
  const [draftToRestore, setDraftToRestore] = useState<string | null>(null);
  const [rollbackPreview, setRollbackPreview] =
    useState<ConversationContextValue["rollbackPreview"]>(null);
  const [yoloMode, setYoloModeState] = useState(false);
  const [isUpdatingYoloMode, setIsUpdatingYoloMode] = useState(false);
  const [pendingToolAuthorizations, setPendingToolAuthorizations] = useState<
    ConversationContextValue["pendingToolAuthorizations"]
  >([]);
  const [activePendingMessages, setActivePendingMessages] = useState<string[]>(
    []
  );
  const [compactionPreview, setCompactionPreview] = useState("");
  const [compactionError, setCompactionError] = useState<string | null>(null);
  const [isCompacting, setIsCompacting] = useState(false);

  // --- Refs ---
  const sessionsRefData = useRef<
    ConversationContextValue["sessionsRefData"]["current"]
  >(new Map());
  const activeConversationIdRef = useRef<string | undefined>(undefined);
  const selectionRequestIdRef = useRef(0);
  const loadingOlderConversationIdsRef = useRef(new Set<string>());
  const sessionsRef = useRef<
    ConversationContextValue["sessionsRef"]["current"]
  >({});
  sessionsRef.current = sessions;

  const pendingQueueRef = useRef<
    ConversationContextValue["pendingQueueRef"]["current"]
  >(new Map());
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
    new Map<
      string,
      ConversationContextValue["pendingToolAuthorizationRef"]["current"] extends Map<
        string,
        infer V
      >
        ? V
        : never
    >()
  );
  const pendingUserQuestionRef = useRef(
    new Map<
      string,
      ConversationContextValue["pendingUserQuestionRef"]["current"] extends Map<
        string,
        infer V
      >
        ? V
        : never
    >()
  );
  const userQuestionTargetRef = useRef(
    new Map<
      string,
      ConversationContextValue["userQuestionTargetRef"]["current"] extends Map<
        string,
        infer V
      >
        ? V
        : never
    >()
  );
  const activeApiConfigRef = useRef<ApiConfigRecord | null>(null);
  yoloModeRef.current = yoloMode;

  // --- Load active API config once ---
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
        // Best effort -- auto-compaction simply won't trigger if config is unavailable.
      });
    return () => {
      disposed = true;
    };
  }, []);

  // --- Build context object ---
  const ctx: ConversationContextValue = {
    directoryId,
    directoryPath,
    sessions,
    activeConversationId,
    conversationVersion,
    upsertedConversation,
    subAgentSessionEvent,
    streamingConversationIds,
    completedConversationIds,
    isLoadingInitialHistory,
    draftToRestore,
    rollbackPreview,
    yoloMode,
    isUpdatingYoloMode,
    pendingToolAuthorizations,
    activePendingMessages,
    compactionPreview,
    compactionError,
    isCompacting,

    sessionsRefData,
    activeConversationIdRef,
    selectionRequestIdRef,
    loadingOlderConversationIdsRef,
    sessionsRef,
    pendingQueueRef,
    handleSendMessageRef,
    performCompactionRef,
    yoloModeRef,
    alwaysApprovedToolsRef,
    pendingToolAuthorizationRef,
    pendingUserQuestionRef,
    userQuestionTargetRef,
    activeApiConfigRef,

    setSessions,
    setActiveConversationId,
    setConversationVersion,
    setUpsertedConversation,
    setSubAgentSessionEvent,
    setStreamingConversationIds,
    setCompletedConversationIds,
    setIsLoadingInitialHistory,
    setDraftToRestore,
    setRollbackPreview,
    setYoloModeState,
    setIsUpdatingYoloMode,
    setPendingToolAuthorizations,
    setActivePendingMessages,
    setCompactionPreview,
    setCompactionError,
    setIsCompacting,

    // These will be filled in after sub-hooks are called
    setActiveId: () => {},
    ensureSession: () => {},
    updateSessionMessages: () => {},
    updateSessionField: () => {},
    migrateSession: () => {},
    addStreamingId: () => {},
    removeStreamingId: () => {},
  };

  // --- 1. Conversation session management ---
  const sessionApi = useConversationSession(ctx);
  ctx.setActiveId = sessionApi.setActiveId;
  ctx.ensureSession = sessionApi.ensureSession;
  ctx.updateSessionMessages = sessionApi.updateSessionMessages;
  ctx.updateSessionField = sessionApi.updateSessionField;
  ctx.migrateSession = sessionApi.migrateSession;
  ctx.addStreamingId = sessionApi.addStreamingId;
  ctx.removeStreamingId = sessionApi.removeStreamingId;

  // --- 2. Tool authorization ---
  const toolAuthApi = useToolAuthorization(ctx);

  // --- 3. User question ---
  const userQuestionApi = useUserQuestion(ctx);

  // --- 4. Compaction ---
  const compactionApi = useCompaction(ctx);
  performCompactionRef.current = compactionApi.performCompaction;

  // --- 5. Agent loop (handleSendMessage) ---
  const agentLoopApi = useAgentLoop({
    ctx,
    requestToolAuthorizations: toolAuthApi.requestToolAuthorizations,
    rejectAllToolAuthorizations: toolAuthApi.rejectAllToolAuthorizations,
    rejectPendingUserQuestions: userQuestionApi.rejectPendingUserQuestions,
  });

  // --- 6. Conversation management (select, new, abort, fork, etc.) ---
  const conversationManagementApi = useConversationManagement({
    ctx,
    rejectAllToolAuthorizations: toolAuthApi.rejectAllToolAuthorizations,
    rejectPendingUserQuestions: userQuestionApi.rejectPendingUserQuestions,
  });

  // --- 7. Rollback ---
  const rollbackApi = useRollback(ctx);

  // --- Compute active session ---
  const activeKey = activeConversationId ?? PENDING_SESSION_KEY;
  const activeSession = sessions[activeKey];

  // --- Approve/reject tool authorization wrappers ---
  const approveToolAuthorization = useCallback(
    (toolCall: ConversationContextValue["pendingToolAuthorizations"][number]) =>
      toolAuthApi.settleToolAuthorization(toolCall, {
        status: "approved",
        sensitiveCommandConfirmed:
          (toolCall.sensitiveCommandMatches?.length ?? 0) > 0,
      }),
    [toolAuthApi]
  );

  const rejectToolAuthorization = useCallback(
    (
      toolCall: ConversationContextValue["pendingToolAuthorizations"][number],
      reason: string
    ) =>
      toolAuthApi.settleToolAuthorization(toolCall, {
        status: "rejected",
        reason: reason.trim() || "User declined tool execution",
      }),
    [toolAuthApi]
  );

  return {
    messages: activeSession?.messages ?? [],
    summary: activeSession?.summary ?? "",
    conversationVersion,
    upsertedConversation,
    subAgentSessionEvent,
    sessions,
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
    loadOlderMessages: conversationManagementApi.loadOlderMessages,
    handleSendMessage: agentLoopApi.handleSendMessage,
    pendingMessages: activePendingMessages,
    withdrawPendingMessage: conversationManagementApi.withdrawPendingMessage,
    compactConversation: compactionApi.compactConversation,
    compactionPreview,
    compactionError,
    isCompacting,
    handleSelectConversation:
      conversationManagementApi.handleSelectConversation,
    handleNewChat: conversationManagementApi.handleNewChat,
    refreshConversations: conversationManagementApi.refreshConversations,
    isStreaming: activeSession?.isStreaming ?? false,
    isAborting: activeSession?.isAborting ?? false,
    handleAbort: conversationManagementApi.handleAbort,
    abortConversation: conversationManagementApi.abortConversation,
    handleForkConversation: conversationManagementApi.handleForkConversation,
    draftToRestore,
    clearDraftToRestore: rollbackApi.clearDraftToRestore,
    handleRollback: rollbackApi.handleRollback,
    rollbackPreview,
    confirmRollback: rollbackApi.confirmRollback,
    cancelRollback: rollbackApi.cancelRollback,
    yoloMode,
    isUpdatingYoloMode,
    setYoloMode: toolAuthApi.setYoloMode,
    refreshYoloMode: toolAuthApi.refreshYoloMode,
    pendingToolAuthorizations,
    approveToolAuthorization,
    approveToolAuthorizationAlways: toolAuthApi.approveToolAuthorizationAlways,
    rejectToolAuthorization,
    answerUserQuestion: userQuestionApi.answerUserQuestion,
    cancelUserQuestion: userQuestionApi.cancelUserQuestion,
  };
};
