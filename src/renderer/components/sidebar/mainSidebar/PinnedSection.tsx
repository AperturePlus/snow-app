import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { useI18n } from "../../../i18n";
import { useChatConversationContext } from "../../mainContent/chatMessages";
import type {
  ChatConversationRecord,
  WorkspaceDirectoryRecord,
} from "../../../../preload";
import { ChatItem } from "./ChatItem";

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
    conversationVersion,
    upsertedConversation,
    refreshConversations,
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
  }, [directoryId, conversationVersion]);

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
    refreshConversations();
  };

  const handleDelete = async (
    conversation: ChatConversationRecord
  ): Promise<void> => {
    try {
      abortConversation(conversation.conversationId);
      await window.snow.deleteConversation(conversation.conversationId);
      if (conversation.conversationId === activeConversationId) {
        handleNewChat();
      }
      refreshConversations();
    } catch {
      // 静默失败
    }
  };

  return (
    <div className="sidebar-section">
      <div className="section-header">
        <span className="section-title">
          {t("sidebar.pinned", { defaultValue: "Pinned" })}
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
              onPin={() => void handleUnpin(conversation)}
              onRename={(newTitle) => handleRename(conversation, newTitle)}
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
                    cacheReadInputTokens: conversation.cacheReadInputTokens,
                  },
                  conversation.directoryId
                )
              }
            />
          ))
        )}
      </div>
    </div>
  );
}
