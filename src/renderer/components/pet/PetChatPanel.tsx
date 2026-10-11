/**
 * 宠物聊天面板（双击宠物后变形出的小对话窗口）。
 *
 * 与「btw」式旁路会话同义：消息只存在于宠物窗口的内存里，不写入任何会话，
 * 请求由主进程复用主流程的流式入口发出，并以当前打开的会话作为背景；
 * 没有打开会话时退化为纯闲聊。聊天状态由 usePetChat 持有（收起宠物不丢对话）。
 *
 * 输入区是 contentEditable：直接复用主聊天输入框的 chip 体系
 * （fileTagUtils）以支持粘贴图片 —— 图片以 chip 形式插入，发送时序列化为
 * `@@image:<data url>@@`，由 Rust 侧解析为多模态图片部分。
 */
import { useEffect, useRef } from "react";
import { ArrowUp, MessageSquarePlus, PawPrint, Square, X } from "lucide-react";
import type {
  PetChatContext,
  PetChatLabels,
  PetManifest,
} from "../../../preload/types/pets";
import {
  buildSegmentsHtml,
  createImageChipHtml,
  insertHtmlAtSelection,
  isEditableContentEmpty,
  parseContentSegments,
  readEditableContent,
  renumberImageChips,
} from "../mainContent/chatInput/fileTagUtils";
import { PetStage } from "./PetStage";
import type { PetChatController } from "./usePetChat";

/**
 * 背景 idle 动画的缩放与透明度。动画绘制在面板底色之上、消息之下：
 * 这样它是「可见但淡」的背景图，而不是被不透明底色挡掉（此前的做法）。
 */
const BACKGROUND_SCALE = 1.7;
const BACKGROUND_OPACITY = 0.26;

type PetChatPanelProps = {
  manifest: PetManifest;
  /** 动画播放速度倍率（与宠物设置一致） */
  speed: number;
  labels: PetChatLabels;
  chatContext: PetChatContext;
  chat: PetChatController;
  onClose: () => void;
};

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Failed to read image file"));
    reader.readAsDataURL(file);
  });

export function PetChatPanel({
  manifest,
  speed,
  labels,
  chatContext,
  chat,
  onClose,
}: PetChatPanelProps): React.JSX.Element {
  const { messages, draft, isStreaming, toolActivity, send, stop, reset } =
    chat;
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLDivElement | null>(null);

  // 展开聊天后还原草稿并聚焦输入框（双击宠物时窗口已获得焦点），无需再点一次。
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) {
      return;
    }
    restoredRef.current = true;
    const el = inputRef.current;
    if (!el) {
      return;
    }
    if (draft.trim()) {
      // 草稿来自本窗口自己的编辑区（同源可信），按 chip 还原。
      el.innerHTML = buildSegmentsHtml(parseContentSegments(draft));
      renumberImageChips(el);
    }
    el.focus();
  }, [draft]);

  // 新消息 / 增量到达时贴底滚动。
  useEffect(() => {
    const list = listRef.current;
    if (list) {
      list.scrollTop = list.scrollHeight;
    }
  }, [messages]);

  const syncDraft = (): void => {
    const el = inputRef.current;
    chat.setDraft(el ? readEditableContent(el) : "");
  };

  /** 确保光标落在输入区内（粘贴图片时可能没有活动选区）。 */
  const ensureCaretInInput = (): HTMLDivElement | null => {
    const el = inputRef.current;
    if (!el) {
      return null;
    }
    const selection = window.getSelection();
    const inside = Boolean(
      selection &&
      selection.rangeCount > 0 &&
      selection.anchorNode &&
      el.contains(selection.anchorNode),
    );
    if (!inside) {
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    return el;
  };

  const insertImageFiles = async (files: File[]): Promise<void> => {
    const htmls: string[] = [];
    for (const file of files) {
      try {
        const dataUrl = await readFileAsDataUrl(file);
        const extension =
          (file.type.split("/")[1] ?? "png").split("+")[0] || "png";
        htmls.push(
          createImageChipHtml({ name: `image.${extension}`, dataUrl }),
        );
      } catch {
        // 单张图片读取失败时跳过，不影响其余图片与文本
      }
    }
    if (htmls.length === 0) {
      return;
    }
    const el = ensureCaretInInput();
    if (!el) {
      return;
    }
    insertHtmlAtSelection(htmls.join(""));
    renumberImageChips(el);
    syncDraft();
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLDivElement>): void => {
    const clipboard = event.clipboardData;
    if (!clipboard) {
      return;
    }
    const imageFiles: File[] = [];
    for (const item of Array.from(clipboard.items)) {
      if (item.kind !== "file" || !item.type.startsWith("image/")) {
        continue;
      }
      const file = item.getAsFile();
      if (file) {
        imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      event.preventDefault();
      void insertImageFiles(imageFiles);
      return;
    }
    // 纯文本：统一按纯文本插入，避免带入外部富文本样式（chip 剪贴板
    // 格式不在宠物窗口的处理范围内）。
    const text = clipboard.getData("text/plain");
    if (!text) {
      return;
    }
    event.preventDefault();
    document.execCommand("insertText", false, text);
    syncDraft();
  };

  const handleInputClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const removeButton = target.closest<HTMLElement>(
      "[data-chip-remove='true']",
    );
    if (!removeButton) {
      return;
    }
    removeButton.parentElement?.remove();
    syncDraft();
  };

  const handleSend = (): void => {
    const el = inputRef.current;
    if (!el || isStreaming) {
      return;
    }
    const content = readEditableContent(el);
    if (isEditableContentEmpty(content)) {
      return;
    }
    send(content);
    el.innerHTML = "";
    el.focus();
  };

  const handleNewChat = (): void => {
    reset();
    const el = inputRef.current;
    if (el) {
      el.innerHTML = "";
      el.focus();
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }
    // 输入法组合期间的 Enter（确认候选词）不触发发送，与主输入框一致。
    const nativeEvent = event.nativeEvent as KeyboardEvent & {
      keyCode?: number;
    };
    if (nativeEvent.isComposing || nativeEvent.keyCode === 229) {
      return;
    }
    event.preventDefault();
    handleSend();
  };

  const contextHint = chatContext.conversationId
    ? chatContext.title
      ? `${labels.hintTitle} · ${chatContext.title}`
      : labels.hintContext
    : labels.hintFree;
  const isEmptyDraft = isEditableContentEmpty(draft);
  // 工具状态行：仅在工具仍在执行时显示（完成/失败即让位给最终回复）。
  const showsToolStatus =
    isStreaming && toolActivity !== null && toolActivity.status === "running";
  const toolStatusText = toolActivity
    ? toolActivity.detail
      ? `${labels.toolRunning} · ${toolActivity.detail}`
      : labels.toolRunning
    : "";

  return (
    <div className="pet-chat-panel">
      <div
        className="pet-chat-bg"
        aria-hidden="true"
        style={{ opacity: BACKGROUND_OPACITY }}
      >
        <PetStage
          manifest={manifest}
          scale={BACKGROUND_SCALE}
          speed={speed}
          activity="idle"
          dragState={null}
        />
      </div>

      <div className="pet-chat-header" data-pet-drag="true">
        <span className="pet-chat-avatar">
          <PawPrint size={14} strokeWidth={1.8} />
        </span>
        <span className="pet-chat-titles">
          <span className="pet-chat-name">{manifest.displayName}</span>
          <span className="pet-chat-hint" title={contextHint}>
            {contextHint}
          </span>
        </span>
        <button
          className="pet-chat-icon-btn"
          type="button"
          onClick={handleNewChat}
          aria-label={labels.newChat}
          title={labels.newChat}
        >
          <MessageSquarePlus size={14} strokeWidth={2} />
        </button>
        <button
          className="pet-chat-icon-btn"
          type="button"
          onClick={onClose}
          aria-label={labels.close}
          title={labels.close}
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>

      <div className="pet-chat-messages" ref={listRef}>
        {messages.length === 0 && (
          <div className="pet-chat-empty">
            <span>{contextHint}</span>
          </div>
        )}
        {showsToolStatus && (
          <div className="pet-chat-tool-status">
            <span className="pet-chat-tool-caret" aria-hidden="true" />
            <span>{toolStatusText}</span>
          </div>
        )}
        {messages.map((message) => {
          // 流式回复尚未产出内容时，在气泡里显示「正在思考…」占位。
          const isPending = message.status === "streaming";
          const showsThinking = isPending && message.content.length === 0;
          return (
            <div
              key={message.id}
              className={`pet-chat-row ${
                message.role === "user" ? "user" : "assistant"
              }${message.status === "error" ? " error" : ""}`}
            >
              <div
                className={`pet-chat-bubble${showsThinking ? " pending" : ""}`}
              >
                {showsThinking ? labels.thinking : message.content}
                {isPending && (
                  <span className="pet-chat-caret" aria-hidden="true" />
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="pet-chat-input-row">
        <div
          className="pet-chat-input"
          ref={inputRef}
          contentEditable
          role="textbox"
          aria-multiline="true"
          aria-label={labels.placeholder}
          data-empty={isEmptyDraft ? "true" : "false"}
          data-placeholder={labels.placeholder}
          suppressContentEditableWarning
          onInput={syncDraft}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onClick={handleInputClick}
        />
        {isStreaming ? (
          <button
            className="pet-chat-send stop"
            type="button"
            onClick={stop}
            aria-label={labels.stop}
            title={labels.stop}
          >
            <Square size={13} strokeWidth={2} />
          </button>
        ) : (
          <button
            className="pet-chat-send"
            type="button"
            onClick={handleSend}
            disabled={isEmptyDraft}
            aria-label={labels.send}
            title={labels.send}
          >
            <ArrowUp size={15} strokeWidth={2.4} />
          </button>
        )}
      </div>
    </div>
  );
}
