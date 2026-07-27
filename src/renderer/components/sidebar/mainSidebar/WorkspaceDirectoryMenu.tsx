import { AlertTriangle, Ellipsis, FileSearch, Trash2 } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { useI18n } from "../../../i18n";

type WorkspaceDirectoryMenuProps = {
  canDelete?: boolean;
  disabled?: boolean;
  onDelete: () => void;
  onOpenChange?: (isOpen: boolean) => void;
  onShowDetails?: () => void;
};

type MenuPosition = {
  top: number;
  left: number;
} | null;

const MENU_GAP = 4;
const VIEWPORT_MARGIN = 8;

export function WorkspaceDirectoryMenu({
  canDelete = true,
  disabled,
  onDelete,
  onOpenChange,
  onShowDetails,
}: WorkspaceDirectoryMenuProps): React.JSX.Element {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition>(null);
  const containerRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;

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
    onOpenChangeRef.current?.(isOpen);
  }, [isOpen]);

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

  const handleDeleteClick = (): void => {
    setShowConfirm(true);
  };

  const handleShowDetailsClick = (): void => {
    setIsOpen(false);
    setShowConfirm(false);
    onShowDetails?.();
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
              className="workspace-directory-menu"
              style={
                menuPosition
                  ? { top: menuPosition.top, left: menuPosition.left }
                  : undefined
              }
              role="menu"
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
                <>
                  <button
                    type="button"
                    className="workspace-directory-menu-item"
                    onClick={handleShowDetailsClick}
                    role="menuitem"
                  >
                    <FileSearch size={13} />
                    <span>
                      {t("sidebar.directoryDetails", {
                        defaultValue: "Details",
                      })}
                    </span>
                  </button>
                  {canDelete ? (
                    <button
                      type="button"
                      className="workspace-directory-menu-item danger"
                      disabled={disabled}
                      onClick={handleDeleteClick}
                      role="menuitem"
                    >
                      <Trash2 size={13} />
                      <span>
                        {t("sidebar.deleteDirectory", {
                          defaultValue: "Delete",
                        })}
                      </span>
                    </button>
                  ) : null}
                </>
              )}
            </div>,
            document.body
          )
        : null}
    </span>
  );
}
