import {
  AlertTriangle,
  CheckCheck,
  CheckSquare,
  ChevronRight,
  Loader2,
  Trash2,
  X,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";

import { useI18n } from "../../../i18n";
import { useChatConversationContext } from "../../mainContent/chatMessages";
import { PENDING_SESSION_KEY } from "../../mainContent/chatMessages/utils/conversationTypes";
import type {
  ChatConversationRecord,
  WorkspaceDirectoryRecord,
} from "../../../../preload";
import { ChatItem } from "./ChatItem";
import type { ExportFormat } from "./ChatItemMenu";
import { SubAgentListPanel } from "./SubAgentListPanel";
import {
  groupConversationsByTime,
  parseDbTimestamp,
  type TimeGroupKey,
} from "./chatTimeGroup";

const CHAT_PAGE_SIZE = 20;

/**
 * 排序会话列表：运行中的会话永远置顶，其余按 updatedAt 倒序。
 *
 * 运行中会话（streamingConversationIds）内部按 updatedAt 倒序，
 * 非运行中会话也按 updatedAt 倒序，两组拼接后返回。
 *
 * 必须基于时间戳比较，不能直接用字符串 localeCompare：
 * 占位符会话的 updatedAt 是 ISO UTC 格式（带 T 与 Z），
 * 而数据库返回的是 SQLite 本地时间格式（空格分隔、无时区），
 * 两种格式的字典序与真实时间顺序不一致，会导致新会话排到旧会话下方。
 *
 * 注意：streamingConversationIds 只在会话开始/结束时变化（非每 token），
 * 因此不会导致流式过程中频繁重排序。
 */
const sortConversationsByUpdatedAt = (
  items: ChatConversationRecord[],
  streamingIds?: Set<string>
): ChatConversationRecord[] => {
  if (!streamingIds || streamingIds.size === 0) {
    return [...items].sort(
      (a, b) =>
        parseDbTimestamp(b.updatedAt).getTime() -
          parseDbTimestamp(a.updatedAt).getTime() ||
        b.conversationId.localeCompare(a.conversationId)
    );
  }

  const streaming: ChatConversationRecord[] = [];
  const rest: ChatConversationRecord[] = [];
  for (const item of items) {
    if (streamingIds.has(item.conversationId)) {
      streaming.push(item);
    } else {
      rest.push(item);
    }
  }

  const compareByTime = (
    a: ChatConversationRecord,
    b: ChatConversationRecord
  ): number =>
    parseDbTimestamp(b.updatedAt).getTime() -
      parseDbTimestamp(a.updatedAt).getTime() ||
    b.conversationId.localeCompare(a.conversationId);

  streaming.sort(compareByTime);
  rest.sort(compareByTime);

  return [...streaming, ...rest];
};

type ChatsSectionProps = {
  isSwitchingDirectory: boolean;
  activeDirectory?: WorkspaceDirectoryRecord | null;
};

type SubAgentMap = Record<string, ChatConversationRecord[]>;

export function ChatsSection({
  isSwitchingDirectory,
  activeDirectory,
}: ChatsSectionProps): React.JSX.Element {
  const { t } = useI18n();
  const {
    conversationListVersion,
    upsertedConversation,
    subAgentSessionEvents,
    refreshConversations,
    updateConversationSummary,
    handleSelectConversation,
    handleNewChat,
    activeConversationId,
    abortConversation,
    streamingConversationIds,
    completedConversationIds,
  } = useChatConversationContext();
  const [conversations, setConversations] = useState<ChatConversationRecord[]>(
    []
  );
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subAgentMap, setSubAgentMap] = useState<SubAgentMap>({});
  const [expandedSubAgentConversationIds, setExpandedSubAgentConversationIds] =
    useState<Set<string>>(() => new Set());
  // 多选模式状态
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set()
  );
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  // 会话区域收起/展开（localStorage 持久化，与项目区域一致）
  const [isCollapsed, setIsCollapsed] = useState(() => {
    try {
      return localStorage.getItem("chats-section-collapsed") === "true";
    } catch {
      return false;
    }
  });
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const sectionListRef = useRef<HTMLDivElement | null>(null);
  // 始终持有最新 conversations，供子代理加载 effect 读取。
  // effect 仅以会话 id 集合为依赖：upsert/重排（id 不变）不会重查子代理。
  const conversationsRef = useRef<ChatConversationRecord[]>([]);
  conversationsRef.current = conversations;
  const conversationIdsKey = conversations
    .map((conv) => conv.conversationId)
    .join("\u0000");

  const directoryId = activeDirectory?.directoryId ?? "";
  const hasMore = conversations.length < total;

  useEffect(() => {
    if (!directoryId) {
      setConversations([]);
      setTotal(0);
      return;
    }

    let cancelled = false;

    const loadFirstPage = async (): Promise<void> => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await window.snow.listChatConversationsPaginated(
          directoryId,
          CHAT_PAGE_SIZE,
          0
        );

        if (!cancelled) {
          setConversations(result.items);
          setTotal(result.total);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : t("sidebar.loadChatsError", {
                  defaultValue: "Failed to load chats",
                })
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadFirstPage();

    return () => {
      cancelled = true;
    };
  }, [directoryId, t, conversationListVersion]);

  useEffect(() => {
    if (!upsertedConversation) {
      return;
    }

    const { record: conv } = upsertedConversation;
    if (conv.directoryId !== directoryId) {
      return;
    }
    if (conv.status === "pin") {
      return;
    }

    let isNew = false;
    setConversations((prev) => {
      const existingIndex = prev.findIndex(
        (item) => item.conversationId === conv.conversationId
      );

      if (existingIndex >= 0) {
        // 记录内容未变化时保持原引用，避免无意义的替换与重排序
        // （AI 响应结束后的冗余 upsert 不会触发列表重渲染）
        const existing = prev[existingIndex];
        if (JSON.stringify(existing) === JSON.stringify(conv)) {
          return prev;
        }
        const updated = prev.map((item) =>
          item.conversationId === conv.conversationId ? conv : item
        );
        return sortConversationsByUpdatedAt(updated, streamingConversationIds);
      }

      // If the real conversation arrives, replace the pending placeholder.
      const pendingIndex = prev.findIndex(
        (item) => item.conversationId === PENDING_SESSION_KEY
      );
      if (pendingIndex >= 0) {
        const replaced = prev.map((item, index) =>
          index === pendingIndex ? conv : item
        );
        return sortConversationsByUpdatedAt(replaced, streamingConversationIds);
      }

      isNew = true;
      // New conversation: prepend and re-sort by updatedAt
      return sortConversationsByUpdatedAt(
        [conv, ...prev],
        streamingConversationIds
      );
    });

    if (isNew) {
      setTotal((prev) => prev + 1);
    }
  }, [upsertedConversation, directoryId, streamingConversationIds]);

  // 当流式状态变化时（会话开始/结束），重新排序使运行中会话移到顶部。
  // streamingConversationIds 只在会话开始/结束时变化，不会在流式过程中频繁更新。
  useEffect(() => {
    if (streamingConversationIds.size === 0) {
      return;
    }
    setConversations((prev) =>
      sortConversationsByUpdatedAt(prev, streamingConversationIds)
    );
  }, [streamingConversationIds]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (isLoadingMore || !hasMore || !directoryId || isLoading) {
      return;
    }

    setIsLoadingMore(true);

    try {
      const result = await window.snow.listChatConversationsPaginated(
        directoryId,
        CHAT_PAGE_SIZE,
        conversations.length
      );

      setConversations((prev) => [...prev, ...result.items]);
      setTotal(result.total);
    } catch {
      // Silent fail for pagination
    } finally {
      setIsLoadingMore(false);
    }
  }, [conversations.length, directoryId, hasMore, isLoading, isLoadingMore]);

  useEffect(() => {
    if (!hasMore || isLoading) {
      return;
    }

    const sentinel = loadMoreRef.current;

    if (!sentinel) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadMore();
        }
      },
      {
        root: sectionListRef.current,
        rootMargin: "0px 0px 64px",
        threshold: 0.1,
      }
    );

    observer.observe(sentinel);

    return () => {
      observer.disconnect();
    };
  }, [hasMore, isLoading, loadMore, conversations.length]);

  const showLoading = isSwitchingDirectory || (isLoading && directoryId !== "");

  const handlePin = async (
    conversation: ChatConversationRecord
  ): Promise<void> => {
    try {
      await window.snow.updateConversationStatus(
        conversation.conversationId,
        "pin"
      );
      refreshConversations();
    } catch {
      // Silent fail
    }
  };

  const handleRename = async (
    conversation: ChatConversationRecord,
    newTitle: string
  ): Promise<void> => {
    await window.snow.renameConversation(conversation.conversationId, newTitle);
    // 同步更新内存中 session 的 summary，让 TopBar 标题即时刷新
    updateConversationSummary(conversation.conversationId, newTitle);
    refreshConversations();
  };

  const handleSetEmoji = async (
    conversation: ChatConversationRecord,
    emoji: string
  ): Promise<void> => {
    // 乐观更新：直接修改本地 state，异步落库，不刷新列表
    setConversations((prev) =>
      prev.map((item) =>
        item.conversationId === conversation.conversationId
          ? { ...item, emoji }
          : item
      )
    );
    try {
      await window.snow.updateConversationEmoji(
        conversation.conversationId,
        emoji
      );
    } catch {
      // 落库失败时回滚
      setConversations((prev) =>
        prev.map((item) =>
          item.conversationId === conversation.conversationId
            ? { ...item, emoji: conversation.emoji }
            : item
        )
      );
    }
  };

  const handleDelete = async (
    conversation: ChatConversationRecord
  ): Promise<void> => {
    try {
      // Rust 侧级联删除子代理会话：收集全部待删 ID，以便中止对应流，
      // 并在当前正打开被删会话或其子代理时清空聊天区
      const deleteTargetIds = [
        conversation.conversationId,
        ...(subAgentMap[conversation.conversationId] ?? []).map(
          (sub) => sub.conversationId
        ),
      ];
      for (const targetId of deleteTargetIds) {
        abortConversation(targetId);
      }

      await window.snow.deleteConversation(conversation.conversationId);

      if (
        activeConversationId &&
        deleteTargetIds.includes(activeConversationId)
      ) {
        handleNewChat();
      }
      refreshConversations();
    } catch {
      // Silent fail
    }
  };

  const handleExport = async (
    conversation: ChatConversationRecord,
    format: ExportFormat
  ): Promise<void> => {
    const fileName =
      conversation.summary ||
      conversation.title ||
      t("sidebar.untitledChat", { defaultValue: "Untitled" });
    await window.snow.exportConversation(
      conversation.conversationId,
      format,
      fileName
    );
  };

  // ---------------- 多选批量删除 ----------------

  const enterSelectionMode = (): void => {
    setSelectedIds(new Set());
    setIsConfirmingDelete(false);
    setSelectionMode(true);
  };

  const exitSelectionMode = (): void => {
    setSelectionMode(false);
    setSelectedIds(new Set());
    setIsConfirmingDelete(false);
  };

  /** 收起/展开会话区域；收起时退出多选模式并持久化到 localStorage */
  const toggleCollapsed = (): void => {
    setIsCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("chats-section-collapsed", String(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
    if (!isCollapsed) {
      exitSelectionMode();
    }
  };

  const toggleSelect = (conversationId: string): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(conversationId)) {
        next.delete(conversationId);
      } else {
        next.add(conversationId);
      }
      return next;
    });
    // 变更选择时取消删除确认态
    setIsConfirmingDelete(false);
  };

  const isAllSelected =
    conversations.length > 0 &&
    conversations.every(
      (conv) =>
        conv.conversationId === PENDING_SESSION_KEY ||
        selectedIds.has(conv.conversationId)
    );

  const handleToggleSelectAll = (): void => {
    setSelectedIds((prev) => {
      const next = new Set<string>();
      if (isAllSelected) {
        // 取消全选
        return next;
      }
      for (const conv of conversations) {
        if (conv.conversationId !== PENDING_SESSION_KEY) {
          next.add(conv.conversationId);
        }
      }
      return next;
    });
    setIsConfirmingDelete(false);
  };

  // Esc 退出多选模式
  useEffect(() => {
    if (!selectionMode) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        exitSelectionMode();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectionMode]);

  /**
   * 批量删除选中的会话。
   * - 选中父会话时，Rust 侧会级联删除其全部子代理会话，
   *   因此已选中的父会话子代理无需单独删除，直接跳过。
   * - 删除前中止对应流式会话；若当前正打开被删会话（或其子代理），
   *   则清空聊天区。
   */
  const handleBatchDelete = async (): Promise<void> => {
    if (selectedIds.size === 0 || isDeleting) {
      return;
    }

    const allTargetIds = new Set<string>();
    const parentSelectedIds = new Set<string>();
    for (const id of selectedIds) {
      allTargetIds.add(id);
      const subAgents = subAgentMap[id];
      if (subAgents && subAgents.length > 0) {
        parentSelectedIds.add(id);
        for (const sub of subAgents) {
          allTargetIds.add(sub.conversationId);
        }
      }
    }

    // 父会话被选中时其子代理随级联删除，跳过单独删除
    const deleteIds = Array.from(allTargetIds).filter((id) => {
      if (parentSelectedIds.has(id)) {
        return true;
      }
      return !conversations.some(
        (conv) =>
          parentSelectedIds.has(conv.conversationId) &&
          (subAgentMap[conv.conversationId] ?? []).some(
            (sub) => sub.conversationId === id
          )
      );
    });

    setIsDeleting(true);
    try {
      for (const targetId of allTargetIds) {
        abortConversation(targetId);
      }

      for (const id of deleteIds) {
        await window.snow.deleteConversation(id);
      }

      if (activeConversationId && allTargetIds.has(activeConversationId)) {
        handleNewChat();
      }
      refreshConversations();
      exitSelectionMode();
    } catch {
      // 静默失败，保留多选状态以便重试
    } finally {
      setIsDeleting(false);
    }
  };

  const selectedCount = selectedIds.size;

  const timeGroups = groupConversationsByTime(
    conversations,
    new Date(),
    streamingConversationIds
  );

  useEffect(() => {
    const current = conversationsRef.current;
    if (current.length === 0) {
      setSubAgentMap({});
      return;
    }

    let cancelled = false;

    const loadSubAgents = async (): Promise<void> => {
      const entries = await Promise.all(
        current.map(async (conv) => {
          try {
            const subAgents = await window.snow.listSubAgentConversations(
              conv.conversationId
            );
            return [conv.conversationId, subAgents] as const;
          } catch {
            return [
              conv.conversationId,
              [] as ChatConversationRecord[],
            ] as const;
          }
        })
      );

      if (!cancelled) {
        const map: SubAgentMap = {};
        for (const [id, subs] of entries) {
          if (subs.length > 0) {
            map[id] = subs;
          }
        }
        setSubAgentMap(map);
      }
    };

    void loadSubAgents();

    return () => {
      cancelled = true;
    };
  }, [conversationIdsKey]);

  useEffect(() => {
    const events = Object.values(subAgentSessionEvents);
    if (events.length === 0) {
      return;
    }

    setSubAgentMap((prev) => {
      let next = prev;
      for (const event of events) {
        const { parentConversationId, conversationId, agentName, status } =
          event;

        const existing = next[parentConversationId] ?? [];
        const existingIndex = existing.findIndex(
          (item) => item.conversationId === conversationId
        );

        const subAgentRecord: ChatConversationRecord = {
          conversationId,
          title: agentName,
          summary: "",
          lastMessagePreview: "",
          messageCount: 0,
          model: "",
          apiProfileName: "",
          status: "active",
          directoryId: "",
          forkedFromConversationId: "",
          forkMessageCount: 0,
          conversationType: "sub_agent",
          parentConversationId,
          subAgentId: event.agentId,
          subAgentName: agentName,
          subAgentStatus: status,
          subAgentError: "",
          createdAt: new Date(event.timestamp).toISOString(),
          updatedAt: new Date(event.timestamp).toISOString(),
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          totalDurationMs: 0,
          emoji: "",
        };

        if (existingIndex >= 0) {
          const updated = [...existing];
          updated[existingIndex] = {
            ...updated[existingIndex],
            subAgentStatus: status,
            subAgentName: agentName,
          };
          next = { ...next, [parentConversationId]: updated };
        } else {
          next = {
            ...next,
            [parentConversationId]: [...existing, subAgentRecord],
          };
        }
      }
      return next;
    });
  }, [subAgentSessionEvents]);

  // 当激活的会话是某个父会话的子代理时，自动展开该父会话的面板
  useEffect(() => {
    if (!activeConversationId) {
      return;
    }
    setExpandedSubAgentConversationIds((prev) => {
      const parentIds = Object.keys(subAgentMap).filter((parentId) =>
        subAgentMap[parentId].some(
          (sub) => sub.conversationId === activeConversationId
        )
      );
      if (parentIds.length === 0) {
        return prev;
      }
      const next = new Set(prev);
      for (const parentId of parentIds) {
        next.add(parentId);
      }
      return next;
    });
  }, [subAgentMap, activeConversationId]);

  const handleToggleSubAgentPanel = (conversationId: string): void => {
    setExpandedSubAgentConversationIds((prev) => {
      const next = new Set(prev);
      if (next.has(conversationId)) {
        next.delete(conversationId);
      } else {
        next.add(conversationId);
      }
      return next;
    });
  };

  const getGroupLabel = (key: TimeGroupKey): string => {
    switch (key) {
      case "running":
        return t("sidebar.chatTimeRunning", { defaultValue: "Running" });
      case "today":
        return t("sidebar.chatTimeToday", { defaultValue: "Today" });
      case "yesterday":
        return t("sidebar.chatTimeYesterday", {
          defaultValue: "Yesterday",
        });
      case "last7days":
        return t("sidebar.chatTimeLast7Days", {
          defaultValue: "Last 7 days",
        });
      case "earlier":
        return t("sidebar.chatTimeEarlier", { defaultValue: "Earlier" });
      default:
        return "";
    }
  };

  return (
    <div
      className={`sidebar-section chats-section${
        isCollapsed ? " collapsed" : ""
      }`}
    >
      <div className="section-header">
        {selectionMode ? (
          <div className="chats-select-toolbar">
            <span className="chats-select-count">
              {t("sidebar.chatSelectedCount", {
                values: { count: selectedCount },
                defaultValue: "{{count}} selected",
              })}
            </span>
            <span className="section-actions chats-select-actions">
              <button
                type="button"
                className="section-toggle-btn"
                onClick={handleToggleSelectAll}
              >
                <CheckCheck size={12} />
                <span className="chats-select-btn-label">
                  {t("sidebar.chatSelectAll", {
                    defaultValue: "Select all",
                  })}
                </span>
              </button>
              {!isConfirmingDelete && (
                <button
                  type="button"
                  className="section-toggle-btn danger"
                  disabled={selectedCount === 0 || isDeleting}
                  onClick={() => setIsConfirmingDelete(true)}
                >
                  <Trash2 size={12} />
                  <span className="chats-select-btn-label">
                    {t("sidebar.chatActionDelete", {
                      defaultValue: "Delete",
                    })}
                  </span>
                </button>
              )}
              <button
                type="button"
                className="section-toggle-btn"
                onClick={exitSelectionMode}
                aria-label={t("common.cancel", { defaultValue: "Cancel" })}
                title={t("common.cancel", { defaultValue: "Cancel" })}
              >
                <X size={13} />
              </button>
            </span>
          </div>
        ) : (
          <>
            <button
              type="button"
              aria-expanded={!isCollapsed}
              className="section-toggle-btn chats-section-toggle"
              onClick={toggleCollapsed}
              title={t("sidebar.chatToggleCollapse", {
                defaultValue: "Collapse chats",
              })}
            >
              <ChevronRight
                className={isCollapsed ? "" : "section-toggle-chevron--open"}
                size={12}
              />
              <span className="section-title">
                {t("sidebar.chats", { defaultValue: "Chats" })}
              </span>
            </button>
            {!isCollapsed && (
              <span className="section-actions">
                <button
                  type="button"
                  className="section-toggle-btn chats-select-mode-btn"
                  onClick={enterSelectionMode}
                  title={t("sidebar.chatSelectMode", {
                    defaultValue: "Multi-select",
                  })}
                >
                  <CheckSquare size={13} />
                </button>
              </span>
            )}
          </>
        )}
      </div>
      {selectionMode && isConfirmingDelete && (
        <div className="chat-item-menu-confirm chats-select-confirm">
          <AlertTriangle
            size={13}
            className="chat-item-menu-confirm-icon"
          />
          <span className="chat-item-menu-confirm-text">
            {t("sidebar.chatBatchDeleteConfirm", {
              values: { count: selectedCount },
              defaultValue:
                "Delete {{count}} selected conversation(s)? Sub-agent conversations of selected chats will also be deleted.",
            })}
          </span>
          <span className="chat-item-menu-confirm-actions">
            <button
              type="button"
              className="chat-item-menu-confirm-btn cancel"
              disabled={isDeleting}
              onClick={() => setIsConfirmingDelete(false)}
            >
              {t("common.cancel", { defaultValue: "Cancel" })}
            </button>
            <button
              type="button"
              className="chat-item-menu-confirm-btn delete"
              disabled={isDeleting}
              onClick={() => void handleBatchDelete()}
            >
              {isDeleting ? (
                <Loader2 size={11} className="spin" />
              ) : (
                t("sidebar.chatActionDelete", { defaultValue: "Delete" })
              )}
            </button>
          </span>
        </div>
      )}
      {!isCollapsed && (
        <div className="section-list" ref={sectionListRef}>
        {showLoading ? (
          <span className="empty-text loading">
            <Loader2 className="spin" size={13} />
            {t("sidebar.loadingWorkspaceContent", {
              defaultValue: "Loading workspace content...",
            })}
          </span>
        ) : !directoryId ? (
          <span className="empty-text">
            {t("sidebar.noActiveDirectory", {
              defaultValue: "No active directory",
            })}
          </span>
        ) : error ? (
          <span className="empty-text error">{error}</span>
        ) : conversations.length === 0 ? (
          <span className="empty-text">
            {t("sidebar.noChats", { defaultValue: "No chats" })}
          </span>
        ) : (
          <>
            {timeGroups.map((group) => (
              <div key={group.key}>
                <div className="chat-time-group-header">
                  {getGroupLabel(group.key)}
                </div>
                {group.conversations.map((conversation) => {
                  const subAgentConversations =
                    subAgentMap[conversation.conversationId] ?? [];
                  const isSubAgentPanelExpanded =
                    expandedSubAgentConversationIds.has(
                      conversation.conversationId
                    );
                  return (
                    <Fragment key={conversation.conversationId}>
                      <ChatItem
                        conversation={conversation}
                        isActive={
                          conversation.conversationId === activeConversationId
                        }
                        isStreaming={streamingConversationIds.has(
                          conversation.conversationId
                        )}
                        isCompleted={completedConversationIds.has(
                          conversation.conversationId
                        )}
                        subAgentConversations={subAgentConversations}
                        isSubAgentExpanded={isSubAgentPanelExpanded}
                        selectionMode={selectionMode}
                        isSelected={selectedIds.has(
                          conversation.conversationId
                        )}
                        selectable={
                          conversation.conversationId !== PENDING_SESSION_KEY
                        }
                        onToggleSelect={() =>
                          toggleSelect(conversation.conversationId)
                        }
                        onToggleSubAgentPanel={() =>
                          handleToggleSubAgentPanel(
                            conversation.conversationId
                          )
                        }
                        onPin={() => void handlePin(conversation)}
                        onRename={(newTitle) =>
                          handleRename(conversation, newTitle)
                        }
                        onSetEmoji={(emoji) =>
                          handleSetEmoji(conversation, emoji)
                        }
                        onDelete={() => void handleDelete(conversation)}
                        onExport={(format) =>
                          handleExport(conversation, format)
                        }
                        onSelect={() =>
                          void handleSelectConversation(
                            conversation.conversationId,
                            conversation.summary || conversation.title,
                            {
                              inputTokens: conversation.inputTokens,
                              outputTokens: conversation.outputTokens,
                              cacheCreationInputTokens:
                                conversation.cacheCreationInputTokens,
                              cacheReadInputTokens:
                                conversation.cacheReadInputTokens,
                            },
                            conversation.directoryId
                          )
                        }
                      />
                      {/* 面板渲染在 ChatItem 外部，作为兄弟节点，
                          完全不继承父级会话项的背景色 */}
                      {subAgentConversations.length > 0 &&
                        isSubAgentPanelExpanded && (
                          <SubAgentListPanel
                            conversations={subAgentConversations}
                            activeConversationId={activeConversationId}
                            selectionMode={selectionMode}
                            isSelected={(subConvId) =>
                              selectedIds.has(subConvId)
                            }
                            onToggleSelect={toggleSelect}
                            onSelect={(subConvId) =>
                              void handleSelectConversation(
                                subConvId,
                                undefined,
                                undefined,
                                conversation.directoryId
                              )
                            }
                          />
                        )}
                    </Fragment>
                  );
                })}
              </div>
            ))}
            {hasMore ? (
              <div
                className={`chat-load-more ${
                  isLoadingMore ? "is-loading" : ""
                }`}
                ref={loadMoreRef}
                role={isLoadingMore ? "status" : undefined}
                aria-live="polite"
                aria-label={
                  isLoadingMore
                    ? t("sidebar.chatLoadingMore", {
                        defaultValue: "Loading more chats...",
                      })
                    : undefined
                }
              >
                {isLoadingMore ? (
                  <>
                    <Loader2 className="spin" size={14} aria-hidden="true" />
                    <span>
                      {t("sidebar.chatLoadingMore", {
                        defaultValue: "Loading more chats...",
                      })}
                    </span>
                  </>
                ) : null}
              </div>
            ) : (
              <div className="chat-all-loaded">
                {t("sidebar.chatAllLoaded", {
                  defaultValue: "All chats loaded",
                })}
              </div>
            )}
          </>
        )}
        </div>
      )}
    </div>
  );
}
