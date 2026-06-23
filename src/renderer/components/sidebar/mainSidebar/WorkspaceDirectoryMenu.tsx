import { AlertTriangle, Ellipsis, Trash2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useI18n } from "../../../i18n";

type WorkspaceDirectoryMenuProps = {
  disabled?: boolean;
  onDelete: () => void;
  onOpenChange?: (isOpen: boolean) => void;
};

type MenuPosition = {
  top: number;
  left: number;
} | null;

export function WorkspaceDirectoryMenu({
  disabled,
  onDelete,
  onOpenChange,
}: WorkspaceDirectoryMenuProps): React.JSX.Element {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition>(null);
  const containerRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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
    if (!isOpen || !triggerRef.current) {
      setMenuPosition(null);
      return;
    }

    const rect = triggerRef.current.getBoundingClientRect();
    const menuWidth = 160;
    const menuGap = 4;
    let left = rect.right - menuWidth;
    let top = rect.bottom + menuGap;

    if (left < 8) {
      left = 8;
    }

    if (top + 120 > window.innerHeight) {
      top = rect.top - menuGap - 120;
    }

    setMenuPosition({ top, left });
  }, [isOpen]);

  const handleToggle = (event: React.SyntheticEvent): void => {
    event.stopPropagation();
    event.preventDefault();
    setIsOpen((prev) => !prev);
    setShowConfirm(false);
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
    <span className="workspace-directory-actions-wrapper" ref={containerRef}>
      <span
        className="workspace-directory-actions"
        ref={triggerRef}
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
      {isOpen && menuPosition
        ? createPortal(
            <div
              ref={menuRef}
              className="workspace-directory-menu"
              style={{ top: menuPosition.top, left: menuPosition.left }}
            >
              {showConfirm ? (
                <>
                  <div className="workspace-directory-menu-confirm">
                    <AlertTriangle
                      size={13}
                      className="workspace-directory-menu-confirm-icon"
                    />
                    <span className="workspace-directory-menu-confirm-text">
                      {t("sidebar.directoryDeleteConfirm", {
                        defaultValue:
                          "Are you sure you want to delete this directory?",
                      })}
                    </span>
                  </div>
                  <div className="workspace-directory-menu-confirm-actions">
                    <button
                      type="button"
                      className="workspace-directory-menu-confirm-btn cancel"
                      onClick={handleDeleteCancel}
                    >
                      {t("common.cancel", { defaultValue: "Cancel" })}
                    </button>
                    <button
                      type="button"
                      className="workspace-directory-menu-confirm-btn delete"
                      onClick={handleDeleteConfirm}
                    >
                      {t("sidebar.deleteDirectory", { defaultValue: "Delete" })}
                    </button>
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  className="workspace-directory-menu-item danger"
                  disabled={disabled}
                  onClick={handleDeleteClick}
                >
                  <Trash2 size={13} />
                  <span>
                    {t("sidebar.deleteDirectory", { defaultValue: "Delete" })}
                  </span>
                </button>
              )}
            </div>,
            document.body
          )
        : null}
    </span>
  );
}
