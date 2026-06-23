import {
  Ellipsis,
  Pin,
  PinOff,
  Pencil,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useI18n } from "../../../i18n";

type ChatItemMenuProps = {
  isPinned: boolean;
  onPin: () => void;
  onRename: () => void;
  onDelete: () => void;
  onOpenChange?: (isOpen: boolean) => void;
};

export function ChatItemMenu({
  isPinned,
  onPin,
  onRename,
  onDelete,
  onOpenChange,
}: ChatItemMenuProps): React.JSX.Element {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    onOpenChange?.(isOpen);
  }, [isOpen, onOpenChange]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleClickOutside = (event: MouseEvent): void => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
        setShowConfirm(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const handleToggle = (event: React.SyntheticEvent): void => {
    event.stopPropagation();
    event.preventDefault();
    setIsOpen((prev) => !prev);
    setShowConfirm(false);
  };

  const handlePin = (): void => {
    onPin();
    setIsOpen(false);
  };

  const handleRename = (): void => {
    onRename();
    setIsOpen(false);
  };

  const handleDeleteClick = (): void => {
    setShowConfirm(true);
  };

  const handleDeleteConfirm = (): void => {
    onDelete();
    setIsOpen(false);
    setShowConfirm(false);
  };

  const handleDeleteCancel = (): void => {
    setShowConfirm(false);
  };

  return (
    <span className="chat-item-actions-wrapper" ref={containerRef}>
      <span
        className="chat-item-actions"
        role="button"
        tabIndex={0}
        onClick={handleToggle}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            handleToggle(event);
          }
        }}
      >
        <Ellipsis size={14} />
      </span>
      {isOpen && (
        <div className="chat-item-menu">
          {showConfirm ? (
            <>
              <div className="chat-item-menu-confirm">
                <AlertTriangle
                  size={13}
                  className="chat-item-menu-confirm-icon"
                />
                <span className="chat-item-menu-confirm-text">
                  {t("sidebar.chatDeleteConfirm", {
                    defaultValue:
                      "Are you sure you want to delete this conversation?",
                  })}
                </span>
              </div>
              <div className="chat-item-menu-confirm-actions">
                <button
                  type="button"
                  className="chat-item-menu-confirm-btn cancel"
                  onClick={handleDeleteCancel}
                >
                  {t("common.cancel", { defaultValue: "Cancel" })}
                </button>
                <button
                  type="button"
                  className="chat-item-menu-confirm-btn delete"
                  onClick={handleDeleteConfirm}
                >
                  {t("sidebar.chatActionDelete", { defaultValue: "Delete" })}
                </button>
              </div>
            </>
          ) : (
            <>
              <button
                type="button"
                className="chat-item-menu-item"
                onClick={handlePin}
              >
                {isPinned ? <PinOff size={13} /> : <Pin size={13} />}
                <span>
                  {isPinned
                    ? t("sidebar.chatActionUnpin", { defaultValue: "Unpin" })
                    : t("sidebar.chatActionPin", { defaultValue: "Pin" })}
                </span>
              </button>
              <button
                type="button"
                className="chat-item-menu-item"
                onClick={handleRename}
              >
                <Pencil size={13} />
                <span>
                  {t("sidebar.chatActionRename", { defaultValue: "Rename" })}
                </span>
              </button>
              <button
                type="button"
                className="chat-item-menu-item danger"
                onClick={handleDeleteClick}
              >
                <Trash2 size={13} />
                <span>
                  {t("sidebar.chatActionDelete", { defaultValue: "Delete" })}
                </span>
              </button>
            </>
          )}
        </div>
      )}
    </span>
  );
}
