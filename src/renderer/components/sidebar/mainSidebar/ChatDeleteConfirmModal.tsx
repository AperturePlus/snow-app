import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { useI18n } from "../../../i18n";
import { Modal } from "../../common/Modal";

type ChatDeleteConfirmModalProps = {
  open: boolean;
  /** 待删除的会话 ID（单选一个；批量多个） */
  conversationIds: string[];
  /** 会话数量（弹窗文案用） */
  conversationCount: number;
  deleting: boolean;
  onClose: () => void;
  /** 确认删除；deleteImages=true 表示同时级联删除图库图片 */
  onConfirm: (deleteImages: boolean) => void;
};

/**
 * 删除会话确认弹窗（单选 + 批量共用）。
 * 打开时查询所选会话引用的图库图片数，>0 时展示
 * 「同时删除生成图片」选项（默认不勾选，勾选后级联删除）。
 */
export const ChatDeleteConfirmModal = ({
  open,
  conversationIds,
  conversationCount,
  deleting,
  onClose,
  onConfirm,
}: ChatDeleteConfirmModalProps): React.JSX.Element | null => {
  const { t } = useI18n();
  const [imagesCount, setImagesCount] = useState<number | null>(null);
  const [deleteImages, setDeleteImages] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    setImagesCount(null);
    setDeleteImages(false);
    if (conversationIds.length === 0) {
      setImagesCount(0);
      return;
    }
    let cancelled = false;
    void window.snow
      .countConversationImages(conversationIds)
      .then((count) => {
        if (!cancelled) {
          setImagesCount(count);
        }
      })
      .catch((error) => {
        console.warn(
          "[chat] countConversationImages failed (delete confirm modal):",
          error
        );
        if (!cancelled) {
          setImagesCount(0);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, conversationIds]);

  const isBatch = conversationCount > 1;

  return (
    <Modal
      open={open}
      title={t("sidebar.chatDeleteConfirmTitle", {
        defaultValue: "Confirm deletion",
      })}
      description={
        isBatch
          ? t("sidebar.chatMultiSelectDeleteConfirm", {
              defaultValue: "Delete {{count}} selected conversations?",
              values: { count: conversationCount },
            })
          : t("sidebar.chatDeleteConfirm", {
              defaultValue:
                "Are you sure you want to delete this conversation?",
            })
      }
      closeLabel={t("common.cancel", { defaultValue: "Cancel" })}
      onClose={onClose}
      closeDisabled={deleting}
      className="chat-delete-confirm-modal"
      footer={
        <div className="api-settings-form-actions">
          <button
            type="button"
            className="api-settings-form-btn secondary"
            onClick={onClose}
            disabled={deleting}
          >
            {t("common.cancel", { defaultValue: "Cancel" })}
          </button>
          <button
            type="button"
            className="api-settings-form-btn primary chat-delete-confirm-btn"
            onClick={() => onConfirm(deleteImages)}
            disabled={deleting}
          >
            {deleting ? (
              <Loader2
                className="tool-call-icon-spinning"
                size={13}
                aria-hidden="true"
              />
            ) : (
              <Trash2 size={13} strokeWidth={2} aria-hidden="true" />
            )}
            {t("sidebar.chatActionDelete", { defaultValue: "Delete" })}
          </button>
        </div>
      }
    >
      {imagesCount !== null && imagesCount > 0 ? (
        <label className="chat-delete-confirm-option">
          <input
            type="checkbox"
            checked={deleteImages}
            onChange={(event) => setDeleteImages(event.target.checked)}
            disabled={deleting}
          />
          <span>
            {isBatch
              ? t("sidebar.chatDeleteImagesOptionBatch", {
                  defaultValue:
                    "Also delete the {{count}} image(s) generated in the selected conversations (removed from the image library)",
                  values: { count: imagesCount },
                })
              : t("sidebar.chatDeleteImagesOption", {
                  defaultValue:
                    "Also delete the {{count}} image(s) generated in this conversation (removed from the image library)",
                  values: { count: imagesCount },
                })}
          </span>
        </label>
      ) : null}
      <p className="chat-delete-confirm-note">
        <AlertTriangle size={12} aria-hidden="true" />
        <span>
          {t("sidebar.chatDeleteImagesNote", {
            defaultValue:
              "Uncheck to keep generated images in the image library.",
          })}
        </span>
      </p>
    </Modal>
  );
};
