import {
  Ellipsis,
  Pin,
  PinOff,
  Pencil,
  Trash2,
  AlertTriangle,
  Download,
  ChevronRight,
  ChevronLeft,
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

export type ExportFormat = "markdown" | "html" | "json" | "csv";

type ChatItemMenuProps = {
  isPinned: boolean;
  onPin: () => void;
  onRename: () => void;
  onDelete: () => void;
  onExport: (format: ExportFormat) => void;
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
  onExport,
  onOpenChange,
}: ChatItemMenuProps): React.JSX.Element {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition>(null);
  const [exportPosition, setExportPosition] = useState<MenuPosition>(null);
  const containerRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const exportPanelRef = useRef<HTMLDivElement>(null);
  const exportTriggerRef = useRef<HTMLButtonElement>(null);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;

  const computePosition = useCallback(
    (
      triggerRect: DOMRect,
      panelRect: DOMRect,
      preferredSide: "right" | "left" | "below" | "above"
    ): MenuPosition => {
      let preferredTop: number;
      let preferredLeft: number;

      if (preferredSide === "right") {
        preferredTop = triggerRect.top;
        preferredLeft = triggerRect.right + MENU_GAP;
      } else if (preferredSide === "left") {
        preferredTop = triggerRect.top;
        preferredLeft = triggerRect.left - panelRect.width - MENU_GAP;
      } else if (preferredSide === "above") {
        preferredTop = triggerRect.top - panelRect.height - MENU_GAP;
        preferredLeft = triggerRect.left;
      } else {
        preferredTop = triggerRect.bottom + MENU_GAP;
        preferredLeft = triggerRect.left;
      }

      const maxTop = Math.max(
        VIEWPORT_MARGIN,
        window.innerHeight - panelRect.height - VIEWPORT_MARGIN
      );
      const maxLeft = Math.max(
        VIEWPORT_MARGIN,
        window.innerWidth - panelRect.width - VIEWPORT_MARGIN
      );

      return {
        top: Math.min(Math.max(preferredTop, VIEWPORT_MARGIN), maxTop),
        left: Math.min(Math.max(preferredLeft, VIEWPORT_MARGIN), maxLeft),
      };
    },
    []
  );

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
    const side: "above" | "below" = shouldOpenUpward ? "above" : "below";

    setMenuPosition(computePosition(triggerRect, menuRect, side));
  }, [computePosition]);

  const updateExportPosition = useCallback((): void => {
    const trigger = exportTriggerRef.current;
    const panel = exportPanelRef.current;

    if (!trigger || !panel) {
      return;
    }

    const triggerRect = trigger.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const spaceRight =
      window.innerWidth - triggerRect.right - VIEWPORT_MARGIN;
    const side: "right" | "left" =
      spaceRight < panelRect.width + MENU_GAP ? "left" : "right";

    setExportPosition(computePosition(triggerRect, panelRect, side));
  }, [computePosition]);

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
        (menuRef.current && menuRef.current.contains(target)) ||
        (exportPanelRef.current && exportPanelRef.current.contains(target))
      ) {
        return;
      }

      setIsOpen(false);
      setShowConfirm(false);
      setShowExport(false);
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  useLayoutEffect(() => {
    if (!isOpen) {
      setMenuPosition(null);
      setExportPosition(null);
      return;
    }

    updateMenuPosition();
    const menu = menuRef.current;
    const sidebar = triggerRef.current?.closest<HTMLElement>(".sidebar");
    const layoutObserver = new ResizeObserver(() => {
      updateMenuPosition();
      if (showExport) {
        updateExportPosition();
      }
    });

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
  }, [isOpen, updateMenuPosition, showExport, updateExportPosition]);

  useLayoutEffect(() => {
    if (!showExport) {
      setExportPosition(null);
      return;
    }
    updateExportPosition();
  }, [showExport, updateExportPosition]);

  const handleToggle = (event: React.SyntheticEvent): void => {
    event.stopPropagation();
    event.preventDefault();
    setIsOpen((prev) => !prev);
    setShowConfirm(false);
    setShowExport(false);
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
    setShowExport(false);
  };

  const handleDeleteConfirm = (): void => {
    onDelete();
    setIsOpen(false);
    setShowConfirm(false);
  };

  const handleDeleteCancel = (): void => {
    setShowConfirm(false);
  };

  const handleExportClick = (): void => {
    setShowExport((prev) => !prev);
    setShowConfirm(false);
  };

  const handleExportSelect = (format: ExportFormat): void => {
    onExport(format);
    setIsOpen(false);
    setShowExport(false);
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
                    ref={exportTriggerRef}
                    className={`chat-item-menu-item${
                      showExport ? " active" : ""
                    }`}
                    onClick={handleExportClick}
                    role="menuitem"
                    aria-expanded={showExport}
                    aria-haspopup="menu"
                  >
                    <Download size={13} />
                    <span>
                      {t("sidebar.chatActionExport", {
                        defaultValue: "Export",
                      })}
                    </span>
                    <ChevronRight size={11} className="chat-item-menu-sub-arrow" />
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
      {isOpen && showExport
        ? createPortal(
            <div
              ref={exportPanelRef}
              className="chat-item-menu chat-item-export-panel"
              style={
                exportPosition
                  ? { top: exportPosition.top, left: exportPosition.left }
                  : undefined
              }
              role="menu"
            >
              <div className="chat-item-export-panel-header">
                <ChevronLeft size={11} className="chat-item-export-back-icon" />
                <span>
                  {t("sidebar.chatActionExport", {
                    defaultValue: "Export",
                  })}
                </span>
              </div>
              {(
                [
                  { format: "markdown" as const, label: "Markdown" },
                  { format: "html" as const, label: "HTML" },
                  { format: "json" as const, label: "JSON" },
                  { format: "csv" as const, label: "CSV" },
                ] satisfies Array<{ format: ExportFormat; label: string }>
              ).map(({ format, label }) => (
                <button
                  key={format}
                  type="button"
                  className="chat-item-menu-item"
                  onClick={() => handleExportSelect(format)}
                  role="menuitem"
                >
                  <span className="chat-item-export-format-label">{label}</span>
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
    </span>
  );
}
