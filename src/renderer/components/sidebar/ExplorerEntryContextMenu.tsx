import { AlertTriangle, Pencil, Trash2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useI18n } from "../../i18n";

type ExplorerEntryContextMenuProps = {
  entryName: string;
  onClose: () => void;
  onDelete: () => Promise<void>;
  onRename: (newName: string) => Promise<void>;
  position: { x: number; y: number };
};

type MenuMode = "actions" | "delete" | "rename";

export function ExplorerEntryContextMenu({
  entryName,
  onClose,
  onDelete,
  onRename,
  position,
}: ExplorerEntryContextMenuProps): React.JSX.Element {
  const { t } = useI18n();
  const [mode, setMode] = useState<MenuMode>("actions");
  const [newName, setNewName] = useState(entryName);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const [top, setTop] = useState(position.y);

  // 测量菜单实际高度，避免超出窗口底部；三种模式高度不同，切换时重新测量。
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) {
      return;
    }
    const rect = menu.getBoundingClientRect();
    if (rect.bottom > window.innerHeight) {
      setTop(Math.max(8, window.innerHeight - rect.height - 8));
    } else if (rect.top < 8) {
      setTop(8);
    }
  }, [mode]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) {
        return;
      }
      onClose();
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    if (mode === "rename") {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [mode]);

  const handleRenameSubmit = async (
    event: React.FormEvent<HTMLFormElement>
  ): Promise<void> => {
    event.preventDefault();
    const trimmedName = newName.trim();
    if (!trimmedName || isSubmitting) {
      return;
    }

    if (trimmedName === entryName) {
      onClose();
      return;
    }

    setIsSubmitting(true);
    try {
      await onRename(trimmedName);
      onClose();
    } catch {
      // The explorer surfaces operation errors in its content area.
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    try {
      await onDelete();
      onClose();
    } catch {
      // The explorer surfaces operation errors in its content area.
    } finally {
      setIsSubmitting(false);
    }
  };

  const menuWidth = 208;
  const left = Math.min(position.x, window.innerWidth - menuWidth - 8);

  return createPortal(
    <div
      className="explorer-entry-context-menu"
      ref={menuRef}
      role="menu"
      style={{ left: Math.max(8, left), top: Math.max(8, top) }}
    >
      {mode === "actions" ? (
        <>
          <button
            className="explorer-entry-context-menu-item"
            onClick={() => setMode("rename")}
            role="menuitem"
            type="button"
          >
            <Pencil size={13} />
            <span>{t("sidebar.explorerRename", { defaultValue: "Rename" })}</span>
          </button>
          <button
            className="explorer-entry-context-menu-item danger"
            onClick={() => setMode("delete")}
            role="menuitem"
            type="button"
          >
            <Trash2 size={13} />
            <span>{t("sidebar.explorerDelete", { defaultValue: "Delete" })}</span>
          </button>
        </>
      ) : mode === "rename" ? (
        <form className="explorer-entry-context-menu-form" onSubmit={handleRenameSubmit}>
          <label htmlFor="explorer-entry-rename-input">
            {t("sidebar.explorerRename", { defaultValue: "Rename" })}
          </label>
          <input
            id="explorer-entry-rename-input"
            onChange={(event) => setNewName(event.target.value)}
            ref={renameInputRef}
            value={newName}
          />
          <div className="explorer-entry-context-menu-actions">
            <button
              disabled={isSubmitting}
              onClick={() => setMode("actions")}
              type="button"
            >
              {t("common.cancel", { defaultValue: "Cancel" })}
            </button>
            <button disabled={isSubmitting} type="submit">
              {t("common.confirm", { defaultValue: "Confirm" })}
            </button>
          </div>
        </form>
      ) : (
        <div className="explorer-entry-context-menu-confirm">
          <div className="explorer-entry-context-menu-confirm-message">
            <AlertTriangle size={14} />
            <span>
              {t("sidebar.explorerDeleteConfirm", {
                defaultValue: "Delete '{{name}}'? This cannot be undone.",
                values: { name: entryName },
              })}
            </span>
          </div>
          <div className="explorer-entry-context-menu-actions">
            <button
              disabled={isSubmitting}
              onClick={() => setMode("actions")}
              type="button"
            >
              {t("common.cancel", { defaultValue: "Cancel" })}
            </button>
            <button
              className="danger"
              disabled={isSubmitting}
              onClick={() => void handleDelete()}
              type="button"
            >
              {t("sidebar.explorerDelete", { defaultValue: "Delete" })}
            </button>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}
