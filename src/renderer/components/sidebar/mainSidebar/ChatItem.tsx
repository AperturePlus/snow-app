import { GitFork, Loader2, MessageSquareMore } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useI18n } from "../../../i18n";
import type { ChatConversationRecord } from "../../../../preload";
import { ChatItemMenu } from "./ChatItemMenu";
import { formatTimeLabel, parseDbTimestamp } from "./chatTimeGroup";

type ChatItemProps = {
  conversation: ChatConversationRecord;
  isActive?: boolean;
  isStreaming?: boolean;
  isCompleted?: boolean;
  onPin: () => void;
  onRename: (newTitle: string) => Promise<void>;
  onDelete: () => void;
  onSelect?: () => void;
};

export function ChatItem({
  conversation,
  isActive = false,
  isStreaming = false,
  isCompleted = false,
  onPin,
  onRename,
  onDelete,
  onSelect,
}: ChatItemProps): React.JSX.Element {
  const { t } = useI18n();
  const [isEditing, setIsEditing] = useState(false);
  const [editingValue, setEditingValue] = useState("");
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const editInputRef = useRef<HTMLInputElement>(null);
  const isSubmittingRef = useRef(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (isEditing && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [isEditing]);

  const handleRenameStart = (): void => {
    setEditingValue(conversation.summary || conversation.title || "");
    isSubmittingRef.current = false;
    cancelledRef.current = false;
    setIsEditing(true);
  };

  const handleRenameSubmit = async (): Promise<void> => {
    if (isSubmittingRef.current || cancelledRef.current) {
      return;
    }
    isSubmittingRef.current = true;

    const trimmed = editingValue.trim();
    const original = conversation.summary || conversation.title || "";

    if (!trimmed) {
      setEditingValue(original);
      setIsEditing(false);
      isSubmittingRef.current = false;
      return;
    }

    if (trimmed === original) {
      setIsEditing(false);
      isSubmittingRef.current = false;
      return;
    }

    try {
      await onRename(trimmed);
    } finally {
      setIsEditing(false);
      isSubmittingRef.current = false;
    }
  };

  const handleRenameCancel = (): void => {
    cancelledRef.current = true;
    setIsEditing(false);
  };

  const handleRenameKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>
  ): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      void handleRenameSubmit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      handleRenameCancel();
    }
  };

  const isPinned = conversation.status === "pin";
  const isForked = conversation.forkedFromConversationId !== "";
  const displayName =
    conversation.summary ||
    conversation.title ||
    t("sidebar.untitledChat", { defaultValue: "Untitled" });

  const now = new Date();
  const parsedDate = parseDbTimestamp(conversation.updatedAt);
  const rawTimeLabel = formatTimeLabel(parsedDate, now);
  const timeLabel =
    rawTimeLabel === "yesterday"
      ? t("sidebar.chatTimeYesterday", { defaultValue: "Yesterday" })
      : rawTimeLabel;

  const handleSelectClick = (): void => {
    if (isEditing) {
      return;
    }
    onSelect?.();
  };

  return (
    <div
      className={`chat-item${isMenuOpen ? " menu-open" : ""}${
        isActive ? " active" : ""
      }`}
      key={conversation.conversationId}
      onClick={handleSelectClick}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (
          !isEditing &&
          (event.key === "Enter" || event.key === " ") &&
          onSelect
        ) {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <span
        className={`chat-item-icon${isStreaming ? " streaming" : ""}${
          isCompleted && !isStreaming ? " completed" : ""
        }${isForked ? " forked" : ""}`}
      >
        {isStreaming ? (
          <Loader2 size={11} className="spin" />
        ) : isForked ? (
          <GitFork size={11} />
        ) : (
          <MessageSquareMore size={11} />
        )}
        {isCompleted && !isStreaming && <span className="chat-item-badge" />}
      </span>
      <div className="chat-item-content">
        {isEditing ? (
          <input
            ref={editInputRef}
            className="chat-item-rename-input"
            type="text"
            value={editingValue}
            onChange={(event) => setEditingValue(event.target.value)}
            onKeyDown={handleRenameKeyDown}
            onBlur={() => void handleRenameSubmit()}
            placeholder={t("sidebar.chatRenamePlaceholder", {
              defaultValue: "Enter new name",
            })}
          />
        ) : (
          <>
            <div className="chat-item-title-row">
              <span className="chat-item-title">{displayName}</span>
              <span className="chat-item-time">{timeLabel}</span>
            </div>
            {conversation.lastMessagePreview ? (
              <span className="chat-item-preview">
                {conversation.lastMessagePreview}
              </span>
            ) : null}
          </>
        )}
      </div>
      {!isEditing && (
        <span
          className="chat-item-menu-wrapper"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <ChatItemMenu
            isPinned={isPinned}
            onPin={onPin}
            onRename={handleRenameStart}
            onDelete={onDelete}
            onOpenChange={setIsMenuOpen}
          />
        </span>
      )}
    </div>
  );
}
