import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle } from "lucide-react";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export const ConfirmDialog = ({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): React.JSX.Element | null => {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    dialogRef.current?.focus();
  }, [open]);

  if (!open) {
    return null;
  }

  return createPortal(
    <div
      className="confirm-dialog-overlay"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          onCancel();
        }
        if (e.key === "Enter") {
          onConfirm();
        }
      }}
    >
      <div
        className="confirm-dialog"
        ref={dialogRef}
        tabIndex={-1}
      >
        <div className="confirm-dialog-header">
          <div className="confirm-dialog-title">
            <AlertTriangle size={16} />
            <span>{title}</span>
          </div>
        </div>
        <div className="confirm-dialog-body">
          <p>{message}</p>
        </div>
        <div className="confirm-dialog-actions">
          <button
            type="button"
            className="confirm-dialog-btn cancel"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="confirm-dialog-btn confirm"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
