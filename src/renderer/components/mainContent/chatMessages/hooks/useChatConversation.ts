import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatInputSendOptions } from "../../chatInput/types";
import type { ApiConfigRecord } from "../../../../../preload";

import type {
  ConversationContextValue,
  PauseController,
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
  const [autoSendToken, setAutoSendToken] = useState(0);
  const [rollbackPreview, setRollbackPreview] =
    useState<ConversationContextValue["rollbackPreview"]>(null);
  const [newChatRequested, setNewChatRequested] = useState(false);
  const [yoloMode, setYoloModeState] = useState(false);
  const [isUpdatingYoloMode, setIsUpdatingYoloMode] = useState(false);
  const [planMode, setPlanModeState] = useState(false);
  const [isUpdatingPlanMode, setIsUpdatingPlanMode] = useState(false);
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
  const newChatRequestedRef = useRef(false);
  newChatRequestedRef.current = newChatRequested;

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
  const planModeRef = useRef(planMode);
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
  planModeRef.current = planMode;

  // --- Pause controller ---
  // Per-session pause flags. When paused, the agent loop awaits the
  // `resolve` callback before proceeding to the next iteration.
  const pauseControllerRef = useRef<Map<string, PauseController>>(new Map());

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
    newChatRequested,
    yoloMode,
    isUpdatingYoloMode,
    planMode,
    isUpdatingPlanMode,
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
    newChatRequestedRef,
    pendingQueueRef,
    handleSendMessageRef,
    performCompactionRef,
    yoloModeRef,
    planModeRef,
    alwaysApprovedToolsRef,
    pendingToolAuthorizationRef,
    pendingUserQuestionRef,
    userQuestionTargetRef,
    activeApiConfigRef,
    pauseControllerRef,

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
    setNewChatRequested,
    setYoloModeState,
    setIsUpdatingYoloMode,
    setPlanModeState,
    setIsUpdatingPlanMode,
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
    notifyAiComplete: () => {},
    notifySensitiveCommandIntercepted: () => {},
    notifyUserInteractionRequired: () => {},
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
  ctx.notifyAiComplete = sessionApi.notifyAiComplete;
  ctx.notifySensitiveCommandIntercepted =
    sessionApi.notifySensitiveCommandIntercepted;
  ctx.notifyUserInteractionRequired = sessionApi.notifyUserInteractionRequired;

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
  // When the user explicitly requested a new chat (clicked "New chat" while
  // a session was still streaming), do NOT fall back to the pending session.
  // This keeps the empty greeting visible while the background AI loop
  // continues running and eventually migrates to a real conversation id.
  const activeKey =
    newChatRequested || activeConversationId
      ? activeConversationId
      : PENDING_SESSION_KEY;
  const activeSession = activeKey ? sessions[activeKey] : undefined;

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

  // --- Pause / Resume ---
  // handlePause marks the active session as paused. The agent loop checks
  // the pause controller at the start of each iteration and blocks on a
  // promise until handleResume is called or the loop is cancelled.
  const handlePause = useCallback((): void => {
    const key = ctx.activeConversationIdRef.current ?? PENDING_SESSION_KEY;
    const ref = ctx.sessionsRefData.current.get(key);
    if (!ref?.isSending) {
      return;
    }
    let controller = ctx.pauseControllerRef.current.get(key);
    if (!controller) {
      controller = { paused: false, resolve: null };
      ctx.pauseControllerRef.current.set(key, controller);
    }
    if (controller.paused) {
      return;
    }
    controller.paused = true;
    ctx.updateSessionField(key, "isPaused", true);
  }, [ctx]);

  const handleResume = useCallback((): void => {
    const key = ctx.activeConversationIdRef.current ?? PENDING_SESSION_KEY;
    const controller = ctx.pauseControllerRef.current.get(key);
    if (!controller || !controller.paused) {
      return;
    }
    controller.paused = false;
    ctx.updateSessionField(key, "isPaused", false);
    const resolve = controller.resolve;
    controller.resolve = null;
    if (resolve) {
      resolve();
    }
  }, [ctx]);

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
    streamTokenCount: activeSession?.streamTokenCount ?? 0,
    streamElapsedMs: activeSession?.streamElapsedMs ?? 0,
    streamTtftMs: activeSession?.streamTtftMs ?? 0,
    streamStartedAt: activeSession?.streamStartedAt ?? 0,
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
    isPaused: activeSession?.isPaused ?? false,
    handleAbort: conversationManagementApi.handleAbort,
    handlePause,
    handleResume,
    abortConversation: conversationManagementApi.abortConversation,
    handleForkConversation: conversationManagementApi.handleForkConversation,
    draftToRestore,
    autoSendToken,
    clearDraftToRestore: () => {
      rollbackApi.clearDraftToRestore();
      setAutoSendToken(0);
    },
    buildFromContent: (content: string) => {
      conversationManagementApi.handleNewChat();
      setDraftToRestore(content);
      setAutoSendToken(Date.now());
    },
    handleRollback: rollbackApi.handleRollback,
    rollbackPreview,
    confirmRollback: rollbackApi.confirmRollback,
    cancelRollback: rollbackApi.cancelRollback,
    yoloMode,
    isUpdatingYoloMode,
    setYoloMode: toolAuthApi.setYoloMode,
    refreshYoloMode: toolAuthApi.refreshYoloMode,
    planMode,
    isUpdatingPlanMode,
    setPlanMode: toolAuthApi.setPlanMode,
    refreshPlanMode: toolAuthApi.refreshPlanMode,
    pendingToolAuthorizations,
    approveToolAuthorization,
    approveToolAuthorizationAlways: toolAuthApi.approveToolAuthorizationAlways,
    rejectToolAuthorization,
    answerUserQuestion: userQuestionApi.answerUserQuestion,
    cancelUserQuestion: userQuestionApi.cancelUserQuestion,
  };
};
