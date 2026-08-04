import {
  AlertTriangle,
  CheckCheck,
  CheckSquare,
  ChevronRight,
  Loader2,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

import { useI18n } from "../../../i18n";
import { useChatConversationContext } from "../../mainContent/chatMessages";
import type {
  ChatConversationRecord,
  WorkspaceDirectoryRecord,
} from "../../../../preload";
import { ChatItem } from "./ChatItem";
import type { ExportFormat } from "./ChatItemMenu";

type PinnedSectionProps = {
  isSwitchingDirectory: boolean;
  activeDirectory?: WorkspaceDirectoryRecord | null;
};

export function PinnedSection({
  isSwitchingDirectory,
  activeDirectory,
}: PinnedSectionProps): React.JSX.Element {
  const { t } = useI18n();
  const {
    conversationListVersion,
    upsertedConversation,
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
  const [isLoading, setIsLoading] = useState(false);
  // 多选模式状态
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set()
  );
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  // 置顶区域收起/展开（localStorage 持久化，与项目区域一致）
  const [isCollapsed, setIsCollapsed] = useState(() => {
    try {
      return localStorage.getItem("pinned-section-collapsed") === "true";
    } catch {
      return false;
    }
  });

  const directoryId = activeDirectory?.directoryId ?? "";

  useEffect(() => {
    if (!directoryId) {
      setConversations([]);
      return;
    }

    let cancelled = false;

    const loadPinnedConversations = async (): Promise<void> => {
      setIsLoading(true);

      try {
        const result = await window.snow.listPinnedConversations(directoryId);

        if (!cancelled) {
          setConversations(result);
        }
      } catch {
        if (!cancelled) {
          setConversations([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadPinnedConversations();

    return () => {
      cancelled = true;
    };
  }, [directoryId, conversationListVersion]);

  useEffect(() => {
    if (!upsertedConversation) {
      return;
    }

    const { record: conv } = upsertedConversation;
    if (conv.directoryId !== directoryId) {
      return;
    }

    setConversations((prev) => {
      const existing = prev.find(
        (item) => item.conversationId === conv.conversationId
      );

      if (existing) {
        // If the conversation was unpinned, remove it from the pinned list
        if (conv.status !== "pin") {
          return prev.filter(
            (item) => item.conversationId !== conv.conversationId
          );
        }
        // 记录内容未变化时保持原引用，避免无意义替换触发重渲染
        if (JSON.stringify(existing) === JSON.stringify(conv)) {
          return prev;
        }
        // Otherwise update in place
        return prev.map((item) =>
          item.conversationId === conv.conversationId ? conv : item
        );
      }

      // New pinned conversation: prepend
      if (conv.status === "pin") {
        return [conv, ...prev];
      }

      return prev;
    });
  }, [upsertedConversation, directoryId]);

  const showLoading = isSwitchingDirectory || (isLoading && directoryId !== "");

  const handleUnpin = async (
    conversation: ChatConversationRecord
  ): Promise<void> => {
    try {
      await window.snow.updateConversationStatus(
        conversation.conversationId,
        "active"
      );
      refreshConversations();
    } catch {
      // 静默失败
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
      // 置顶列表不维护子代理映射：删除前查询一次，以便级联删除时
      // 中止对应流，并在当前正打开被删会话或其子代理时清空聊天区
      let deleteTargetIds = [conversation.conversationId];
      try {
        const subAgents = await window.snow.listSubAgentConversations(
          conversation.conversationId
        );
        deleteTargetIds = [
          ...deleteTargetIds,
          ...subAgents.map((sub) => sub.conversationId),
        ];
      } catch {
        // 查询失败按无子代理处理，不阻塞删除
      }
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
      // 静默失败
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

  /** 收起/展开置顶区域；收起时退出多选模式并持久化到 localStorage */
  const toggleCollapsed = (): void => {
    setIsCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("pinned-section-collapsed", String(next));
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
    setIsConfirmingDelete(false);
  };

  const isAllSelected =
    conversations.length > 0 &&
    conversations.every((conv) => selectedIds.has(conv.conversationId));

  const handleToggleSelectAll = (): void => {
    setSelectedIds((prev) => {
      if (isAllSelected) {
        return new Set<string>();
      }
      return new Set(conversations.map((conv) => conv.conversationId));
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
   * 批量删除选中的置顶会话。选中父会话时其子代理会话随级联删除：
   * 删除前查询子代理仅用于中止对应流，以及判断当前打开会话是否需要清空。
   */
  const handleBatchDelete = async (): Promise<void> => {
    if (selectedIds.size === 0 || isDeleting) {
      return;
    }

    setIsDeleting(true);
    try {
      const allTargetIds = new Set<string>(selectedIds);
      for (const id of selectedIds) {
        try {
          const subAgents = await window.snow.listSubAgentConversations(id);
          for (const sub of subAgents) {
            allTargetIds.add(sub.conversationId);
          }
        } catch {
          // 查询失败按无子代理处理，不阻塞删除
        }
      }

      for (const targetId of allTargetIds) {
        abortConversation(targetId);
      }

      for (const id of selectedIds) {
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

  return (
    <div
      className={`sidebar-section${isCollapsed ? " collapsed" : ""}`}
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
              className="section-toggle-btn"
              onClick={toggleCollapsed}
              title={t("sidebar.chatToggleCollapse", {
                defaultValue: "Collapse pinned",
              })}
            >
              <ChevronRight
                className={isCollapsed ? "" : "section-toggle-chevron--open"}
                size={12}
              />
              <span className="section-title">
                {t("sidebar.pinned", { defaultValue: "Pinned" })}
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
      <div className="section-list">
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
        ) : conversations.length === 0 ? (
          <span className="empty-text">
            {t("sidebar.noPinnedItems", { defaultValue: "No pinned items" })}
          </span>
        ) : (
          conversations.map((conversation) => (
            <ChatItem
              key={conversation.conversationId}
              conversation={conversation}
              isActive={conversation.conversationId === activeConversationId}
              isStreaming={streamingConversationIds.has(
                conversation.conversationId
              )}
              isCompleted={completedConversationIds.has(
                conversation.conversationId
              )}
              selectionMode={selectionMode}
              isSelected={selectedIds.has(conversation.conversationId)}
              onToggleSelect={() => toggleSelect(conversation.conversationId)}
              onPin={() => void handleUnpin(conversation)}
              onRename={(newTitle) => handleRename(conversation, newTitle)}
              onSetEmoji={(emoji) => handleSetEmoji(conversation, emoji)}
              onDelete={() => void handleDelete(conversation)}
              onExport={(format) => handleExport(conversation, format)}
              onSelect={() =>
                void handleSelectConversation(
                  conversation.conversationId,
                  conversation.summary || conversation.title,
                  {
                    inputTokens: conversation.inputTokens,
                    outputTokens: conversation.outputTokens,
                    cacheCreationInputTokens:
                      conversation.cacheCreationInputTokens,
                    cacheReadInputTokens: conversation.cacheReadInputTokens,
                  },
                  conversation.directoryId
                )
              }
            />
          ))
        )}
      </div>
      )}
    </div>
  );
}
