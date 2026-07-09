import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, FilePen, FilePlus, FileX } from "lucide-react";
import type { CheckpointFileChange } from "../../../../preload";

type RollbackConfirmDialogProps = {
  changes: CheckpointFileChange[];
  isFirstMessage: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

const MAX_VISIBLE_FILES = 50;

const CHANGE_ICON = {
  added: FilePlus,
  modified: FilePen,
  deleted: FileX,
} as const;

const CHANGE_LABEL = {
  added: "新增",
  modified: "修改",
  deleted: "删除",
} as const;

const CHANGE_CLASS = {
  added: "rollback-change-added",
  modified: "rollback-change-modified",
  deleted: "rollback-change-deleted",
} as const;

export const RollbackConfirmDialog = ({
  changes,
  isFirstMessage,
  onConfirm,
  onCancel,
}: RollbackConfirmDialogProps): React.JSX.Element | null => {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  const grouped = useMemo(() => {
    const added = changes.filter((c) => c.changeType === "added");
    const modified = changes.filter((c) => c.changeType === "modified");
    const deleted = changes.filter((c) => c.changeType === "deleted");
    return { added, modified, deleted };
  }, [changes]);

  const visibleChanges = useMemo(
    () => changes.slice(0, MAX_VISIBLE_FILES),
    [changes],
  );
  const hiddenCount = changes.length - visibleChanges.length;

  return createPortal(
    <div
      className="confirm-dialog-overlay"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
        if (e.key === "Enter") {
          e.preventDefault();
          onConfirm();
        }
      }}
    >
      <div className="confirm-dialog rollback-confirm-dialog" ref={dialogRef} tabIndex={-1}>
        <div className="confirm-dialog-header">
          <div className="confirm-dialog-title">
            <AlertTriangle size={16} />
            <span>确认回滚</span>
          </div>
        </div>
        <div className="confirm-dialog-body">
          {isFirstMessage ? (
            <p>
              回滚到第一条消息将删除整个对话（包括所有消息和文件变更），
              对话将从列表中移除。确定要继续吗？
            </p>
          ) : changes.length > 0 ? (
            <>
              <p>
                回滚将撤销此消息之后的所有文件变更，共{" "}
                {changes.length} 个文件受影响：
              </p>
              <div className="rollback-change-summary">
                {grouped.added.length > 0 && (
                  <span className={CHANGE_CLASS.added}>
                    新增 {grouped.added.length}
                  </span>
                )}
                {grouped.modified.length > 0 && (
                  <span className={CHANGE_CLASS.modified}>
                    修改 {grouped.modified.length}
                  </span>
                )}
                {grouped.deleted.length > 0 && (
                  <span className={CHANGE_CLASS.deleted}>
                    删除 {grouped.deleted.length}
                  </span>
                )}
              </div>
              <ul className="rollback-change-list">
                {visibleChanges.map((change) => {
                  const Icon = CHANGE_ICON[change.changeType as keyof typeof CHANGE_ICON] ?? FilePen;
                  return (
                    <li key={change.path} className="rollback-change-item">
                      <Icon
                        size={13}
                        className={`rollback-change-icon ${CHANGE_CLASS[change.changeType as keyof typeof CHANGE_CLASS] ?? ""}`}
                      />
                      <span className="rollback-change-type">
                        {CHANGE_LABEL[change.changeType as keyof typeof CHANGE_LABEL] ?? change.changeType}
                      </span>
                      <span className="rollback-change-path" title={change.path}>
                        {change.path}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {hiddenCount > 0 && (
                <p className="rollback-change-more">
                  还有 {hiddenCount} 个文件未显示...
                </p>
              )}
            </>
          ) : (
            <p>没有文件变更，回滚仅删除此消息及之后的对话内容。确定要继续吗？</p>
          )}
        </div>
        <div className="confirm-dialog-actions">
          <button
            type="button"
            className="confirm-dialog-btn cancel"
            onClick={onCancel}
          >
            取消
          </button>
          <button
            type="button"
            className="confirm-dialog-btn confirm"
            onClick={onConfirm}
          >
            确认回滚
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
