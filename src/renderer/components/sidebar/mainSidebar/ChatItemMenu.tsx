import {
  Ellipsis,
  Pin,
  PinOff,
  Pencil,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { useI18n } from "../../../i18n";

type ChatItemMenuProps = {
  isPinned: boolean;
  onPin: () => void;
  onRename: () => void;
  onDelete: () => void;
  onOpenChange?: (isOpen: boolean) => void;
};

type MenuPosition = {
  top: number;
  left: number;
} | null;

const MENU_GAP = 4;
const VIEWPORT_MARGIN = 8;

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
  const [menuPosition, setMenuPosition] = useState<MenuPosition>(null);
  const containerRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const updateMenuPosition = useCallback((): void => {
    const trigger = triggerRef.current;
    const menu = menuRef.current;

    if (!trigger || !menu) {
      return;
    }

    const triggerRect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const spaceAbove = triggerRect.top - VIEWPORT_MARGIN;
    const spaceBelow =
      window.innerHeight - triggerRect.bottom - VIEWPORT_MARGIN;
    const shouldOpenUpward =
      spaceBelow < menuRect.height + MENU_GAP && spaceAbove > spaceBelow;
    const preferredTop = shouldOpenUpward
      ? triggerRect.top - menuRect.height - MENU_GAP
      : triggerRect.bottom + MENU_GAP;
    const maxTop = Math.max(
      VIEWPORT_MARGIN,
      window.innerHeight - menuRect.height - VIEWPORT_MARGIN
    );
    const maxLeft = Math.max(
      VIEWPORT_MARGIN,
      window.innerWidth - menuRect.width - VIEWPORT_MARGIN
    );

    setMenuPosition({
      top: Math.min(Math.max(preferredTop, VIEWPORT_MARGIN), maxTop),
      left: Math.min(Math.max(triggerRect.left, VIEWPORT_MARGIN), maxLeft),
    });
  }, []);

  useEffect(() => {
    onOpenChange?.(isOpen);
  }, [isOpen, onOpenChange]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleClickOutside = (event: MouseEvent): void => {
      const target = event.target as Node;

      if (
        (containerRef.current && containerRef.current.contains(target)) ||
        (menuRef.current && menuRef.current.contains(target))
      ) {
        return;
      }

      setIsOpen(false);
      setShowConfirm(false);
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  useLayoutEffect(() => {
    if (!isOpen) {
      setMenuPosition(null);
      return;
    }

    updateMenuPosition();
    const menu = menuRef.current;
    const sidebar = triggerRef.current?.closest<HTMLElement>(".sidebar");
    const layoutObserver = new ResizeObserver(updateMenuPosition);

    if (menu) {
      layoutObserver.observe(menu);
    }
    if (sidebar) {
      layoutObserver.observe(sidebar);
    }

    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);

    return () => {
      layoutObserver.disconnect();
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [isOpen, updateMenuPosition]);

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
        ref={triggerRef}
        className="chat-item-actions"
        role="button"
        tabIndex={0}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={handleToggle}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            handleToggle(event);
          }
        }}
      >
        <Ellipsis size={14} />
      </span>
      {isOpen
        ? createPortal(
            <div
              ref={menuRef}
              className="chat-item-menu"
              style={
                menuPosition
                  ? { top: menuPosition.top, left: menuPosition.left }
                  : undefined
              }
              role="menu"
            >
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
                      {t("sidebar.chatActionDelete", {
                        defaultValue: "Delete",
                      })}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="chat-item-menu-item"
                    onClick={handlePin}
                    role="menuitem"
                  >
                    {isPinned ? <PinOff size={13} /> : <Pin size={13} />}
                    <span>
                      {isPinned
                        ? t("sidebar.chatActionUnpin", {
                            defaultValue: "Unpin",
                          })
                        : t("sidebar.chatActionPin", { defaultValue: "Pin" })}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="chat-item-menu-item"
                    onClick={handleRename}
                    role="menuitem"
                  >
                    <Pencil size={13} />
                    <span>
                      {t("sidebar.chatActionRename", {
                        defaultValue: "Rename",
                      })}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="chat-item-menu-item danger"
                    onClick={handleDeleteClick}
                    role="menuitem"
                  >
                    <Trash2 size={13} />
                    <span>
                      {t("sidebar.chatActionDelete", {
                        defaultValue: "Delete",
                      })}
                    </span>
                  </button>
                </>
              )}
            </div>,
            document.body
          )
        : null}
    </span>
  );
}
