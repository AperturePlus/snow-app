import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useI18n } from "../../../i18n";
import { useChatConversationContext } from "../../mainContent/chatMessages";
import type {
  ChatConversationRecord,
  WorkspaceDirectoryRecord,
} from "../../../../preload";
import { ChatItem } from "./ChatItem";
import { groupConversationsByTime, type TimeGroupKey } from "./chatTimeGroup";

const CHAT_PAGE_SIZE = 20;

type ChatsSectionProps = {
  isSwitchingDirectory: boolean;
  activeDirectory?: WorkspaceDirectoryRecord | null;
};

export function ChatsSection({
  isSwitchingDirectory,
  activeDirectory,
}: ChatsSectionProps): React.JSX.Element {
  const { t } = useI18n();
  const {
    conversationVersion,
    refreshConversations,
    handleSelectConversation,
    handleNewChat,
    activeConversationId,
  } = useChatConversationContext();
  const [conversations, setConversations] = useState<ChatConversationRecord[]>(
    []
  );
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

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
  }, [directoryId, t, conversationVersion]);

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
        root: null,
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
    refreshConversations();
  };

  const handleDelete = async (
    conversation: ChatConversationRecord
  ): Promise<void> => {
    try {
      await window.snow.deleteConversation(conversation.conversationId);
      if (conversation.conversationId === activeConversationId) {
        handleNewChat();
      }
      refreshConversations();
    } catch {
      // Silent fail
    }
  };

  const timeGroups = groupConversationsByTime(conversations);

  const getGroupLabel = (key: TimeGroupKey): string => {
    switch (key) {
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
    <div className="sidebar-section">
      <div className="section-header">
        <span className="section-title">
          {t("sidebar.chats", { defaultValue: "Chats" })}
        </span>
      </div>
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
                {group.conversations.map((conversation) => (
                  <ChatItem
                    key={conversation.conversationId}
                    conversation={conversation}
                    isActive={
                      conversation.conversationId === activeConversationId
                    }
                    onPin={() => void handlePin(conversation)}
                    onRename={(newTitle) =>
                      handleRename(conversation, newTitle)
                    }
                    onDelete={() => void handleDelete(conversation)}
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
                        }
                      )
                    }
                  />
                ))}
              </div>
            ))}
            {hasMore ? (
              <div className="chat-load-more" ref={loadMoreRef}>
                {isLoadingMore ? (
                  <>
                    <Loader2 className="spin" size={13} />
                    <span>
                      {t("sidebar.chatLoadingMore", {
                        defaultValue: "Loading more...",
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
    </div>
  );
}
