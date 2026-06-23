import { Loader2, MessageSquare } from "lucide-react";
import { useEffect, useState } from "react";

import { useI18n } from "../../../i18n";
import type { ChatConversationRecord, WorkspaceDirectoryRecord } from "../../../../preload";

type ChatsSectionProps = {
  isSwitchingDirectory: boolean;
  activeDirectory?: WorkspaceDirectoryRecord | null;
};

export function ChatsSection({
  isSwitchingDirectory,
  activeDirectory,
}: ChatsSectionProps): React.JSX.Element {
  const { t } = useI18n();
  const [conversations, setConversations] = useState<ChatConversationRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const directoryId = activeDirectory?.directoryId ?? "";

  useEffect(() => {
    if (!directoryId) {
      setConversations([]);
      return;
    }

    let cancelled = false;

    const loadConversations = async (): Promise<void> => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await window.snow.listChatConversations(directoryId);

        if (!cancelled) {
          setConversations(result);
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

    void loadConversations();

    return () => {
      cancelled = true;
    };
  }, [directoryId, t]);

  const showLoading = isSwitchingDirectory || (isLoading && directoryId !== "");

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
          conversations.map((conversation) => (
            <button
              className="chat-item"
              key={conversation.conversationId}
              type="button"
            >
              <MessageSquare size={13} className="chat-item-icon" />
              <div className="chat-item-content">
                <span className="chat-item-title">
                  {conversation.title || t("sidebar.untitledChat", {
                    defaultValue: "Untitled",
                  })}
                </span>
                {conversation.lastMessagePreview ? (
                  <span className="chat-item-preview">
                    {conversation.lastMessagePreview}
                  </span>
                ) : null}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
