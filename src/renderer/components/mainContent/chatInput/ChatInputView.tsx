import {
  AlertCircle,
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  Keyboard,
  Loader2,
  Paperclip,
  RefreshCw,
  Square,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../../i18n";
import type { ChatInputViewProps } from "./types";
import { TokenUsageRing } from "./TokenUsageRing";
import {
  createChipHtml,
  createImageChipHtml,
  insertHtmlAtSelection,
  readEditableContent,
  type FileTag,
  type ImageTag,
} from "./fileTagUtils";
import {
  FileMentionPopup,
  type FileMentionPopupHandle,
} from "./FileMentionPopup";
import { useDropdownDirection } from "./useDropdownDirection";
import { PlusMenu, type PlusMenuSection } from "./PlusMenu";
import { PendingMessages } from "./PendingMessages";

export const ChatInputView = ({
  placeholder,
  value,
  textareaRef,
  models,
  selectedModel,
  displayModel,
  isLoadingModels,
  modelError,
  isDropdownOpen,
  isManualMode,
  manualValue,
  dropdownRef,
  activeApiConfig,
  requestMethod,
  thinkingOptions,
  thinkingValue,
  thinkingLabel,
  ActiveThinkingIcon,
  isThinkingDropdownOpen,
  isLoadingApiConfig,
  isSavingThinking,
  thinkingError,
  thinkingDropdownRef,
  labels,
  isStreaming,
  isAborting,
  tokenUsage,
  pendingMessages,
  onWithdrawPendingMessage,
  setManualValue,
  setIsManualMode,
  setIsThinkingDropdownOpen,
  handleChange,
  handleSend,
  handleAbort,
  handleKeyDown,
  handleSelectModel,
  handleOpenManualMode,
  handleConfirmManualModel,
  handleManualKeyDown,
  handleRetryFetchModels,
  handleToggleModelDropdown,
  handleSelectThinking,
  restoreContent,
}: ChatInputViewProps): React.JSX.Element => {
  const { t } = useI18n();
  const isDraggingOverRef = useRef(false);
  const [isMentionOpen, setIsMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const mentionAnchorRef = useRef<HTMLDivElement>(null);
  const mentionPopupRef = useRef<FileMentionPopupHandle>(null);
  const mentionStartOffsetRef = useRef<number>(-1);
  const [imagePreview, setImagePreview] = useState<{
    url: string;
    x: number;
    y: number;
  } | null>(null);
  const imagePreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const [imageLightbox, setImageLightbox] = useState<string | null>(null);

  const modelDropdownDir = useDropdownDirection(dropdownRef, isDropdownOpen);
  const thinkingDropdownDir = useDropdownDirection(
    thinkingDropdownRef,
    isThinkingDropdownOpen
  );

  const syncContent = useCallback(() => {
    if (textareaRef.current) {
      const content = readEditableContent(textareaRef.current);
      handleChange(content);
      textareaRef.current.dataset.empty =
        content.trim() === "" ? "true" : "false";
    }
  }, [handleChange, textareaRef]);

  const insertFileTag = useCallback(
    (tag: FileTag) => {
      if (textareaRef.current) {
        textareaRef.current.focus();
      }
      insertHtmlAtSelection(createChipHtml(tag));
      syncContent();
    },
    [syncContent, textareaRef]
  );

  const insertFileTags = useCallback(
    (tags: FileTag[]) => {
      if (textareaRef.current) {
        textareaRef.current.focus();
      }
      const html = tags.map((tag) => createChipHtml(tag)).join(" ");
      insertHtmlAtSelection(html);
      syncContent();
    },
    [syncContent, textareaRef]
  );

  const deleteMentionQuery = useCallback(() => {
    const el = textareaRef.current;
    if (!el || mentionStartOffsetRef.current < 0) {
      return;
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);
    const currentNode = range.startContainer;
    const currentOffset = range.startOffset;

    if (currentNode.nodeType !== Node.TEXT_NODE) {
      return;
    }

    const textNode = currentNode as Text;
    const start = mentionStartOffsetRef.current - 1;
    if (start < 0 || currentOffset <= start) {
      return;
    }

    range.setStart(textNode, start);
    range.setEnd(textNode, currentOffset);
    range.deleteContents();
    selection.removeAllRanges();
    selection.addRange(range);

    mentionStartOffsetRef.current = -1;
  }, [textareaRef]);

  const handleMentionSelect = useCallback(
    (tag: FileTag) => {
      deleteMentionQuery();
      insertFileTag(tag);
    },
    [deleteMentionQuery, insertFileTag]
  );

  const handleMentionSelectBatch = useCallback(
    (tags: FileTag[]) => {
      deleteMentionQuery();
      insertFileTags(tags);
    },
    [deleteMentionQuery, insertFileTags]
  );

  const handleCloseMention = useCallback(() => {
    setIsMentionOpen(false);
    setMentionQuery("");
    mentionStartOffsetRef.current = -1;
  }, []);

  const handleMentionDragStart = useCallback(
    (event: React.DragEvent<HTMLDivElement>, tag: FileTag) => {
      event.dataTransfer.setData("application/json", JSON.stringify(tag));
      event.dataTransfer.effectAllowed = "copy";
    },
    []
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      isDraggingOverRef.current = false;
      if (textareaRef.current) {
        textareaRef.current.classList.remove("drag-over");
      }

      const jsonData = event.dataTransfer.getData("application/json");
      if (!jsonData) {
        return;
      }

      try {
        const parsed = JSON.parse(jsonData) as Partial<FileTag>;
        if (!parsed.path || !parsed.name) {
          return;
        }

        const tag: FileTag = {
          path: parsed.path,
          name: parsed.name,
          isDirectory: parsed.isDirectory ?? false,
        };

        if (textareaRef.current) {
          textareaRef.current.focus();
        }

        insertHtmlAtSelection(createChipHtml(tag));
        syncContent();
      } catch {
        // Ignore invalid drag data
      }
    },
    [syncContent, textareaRef]
  );

  const handleDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      const jsonData = event.dataTransfer.types.includes("application/json");
      if (!jsonData) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      if (!isDraggingOverRef.current && textareaRef.current) {
        isDraggingOverRef.current = true;
        textareaRef.current.classList.add("drag-over");
      }
    },
    [textareaRef]
  );

  const handleDragLeave = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (event.currentTarget === event.target) {
        isDraggingOverRef.current = false;
        if (textareaRef.current) {
          textareaRef.current.classList.remove("drag-over");
        }
      }
    },
    [textareaRef]
  );

  const checkMentionTrigger = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      if (isMentionOpen) {
        handleCloseMention();
      }
      return;
    }

    const range = selection.getRangeAt(0);
    const node = range.startContainer;
    const offset = range.startOffset;

    if (node.nodeType !== Node.TEXT_NODE) {
      if (isMentionOpen) {
        handleCloseMention();
      }
      return;
    }

    const text = (node as Text).textContent ?? "";
    const textBefore = text.slice(0, offset);
    const atMatch = textBefore.match(/(?:^|\s)@([^\s]*)$/);

    if (atMatch) {
      const queryText = atMatch[1];
      const atOffset = offset - queryText.length - 1;

      if (!isMentionOpen) {
        setIsMentionOpen(true);
      }
      mentionStartOffsetRef.current = atOffset + 1;
      setMentionQuery(queryText);
    } else {
      if (isMentionOpen) {
        handleCloseMention();
      }
    }
  }, [isMentionOpen, handleCloseMention]);

  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      event.preventDefault();

      const items = event.clipboardData.items;
      const imageItems: DataTransferItem[] = [];

      for (const item of items) {
        if (item.type.startsWith("image/")) {
          imageItems.push(item);
        }
      }

      if (imageItems.length > 0) {
        for (const imageItem of imageItems) {
          const file = imageItem.getAsFile();
          if (!file) {
            continue;
          }

          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader.result as string;
            if (!dataUrl) {
              return;
            }

            const mimeMatch = file.type.match(/^image\/([a-z]+)$/);
            const ext = mimeMatch ? mimeMatch[1] : "png";
            const imageTag: ImageTag = {
              name:
                file.name && file.name !== "image" ? file.name : `image.${ext}`,
              dataUrl,
            };

            if (textareaRef.current) {
              textareaRef.current.focus();
            }
            insertHtmlAtSelection(createImageChipHtml(imageTag));
            syncContent();
          };
          reader.readAsDataURL(file);
        }
        return;
      }

      const text = event.clipboardData.getData("text/plain");
      if (!text) {
        return;
      }
      const selection = window.getSelection();
      if (!selection || !selection.rangeCount) {
        return;
      }
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const textNode = document.createTextNode(text);
      range.insertNode(textNode);
      range.setStartAfter(textNode);
      range.setEndAfter(textNode);
      selection.removeAllRanges();
      selection.addRange(range);
      syncContent();
      checkMentionTrigger();
    },
    [syncContent, checkMentionTrigger]
  );

  const handleInputWithMention = useCallback(() => {
    syncContent();
    checkMentionTrigger();
  }, [syncContent, checkMentionTrigger]);

  const handleMentionKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const nativeEvent = event.nativeEvent;
      const isComposing =
        nativeEvent.isComposing ||
        (nativeEvent as unknown as { keyCode?: number }).keyCode === 229;

      if (isComposing) {
        return;
      }

      if (isMentionOpen && mentionPopupRef.current) {
        const handled = mentionPopupRef.current.handleKeyDown(event);
        if (handled) {
          return;
        }
      }

      handleKeyDown(event);
    },
    [handleKeyDown, isMentionOpen]
  );

  const showImagePreview = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      const chip = target.closest(
        "[data-image-tag='true']"
      ) as HTMLElement | null;
      if (!chip) {
        if (imagePreviewTimerRef.current) {
          clearTimeout(imagePreviewTimerRef.current);
          imagePreviewTimerRef.current = null;
        }
        setImagePreview(null);
        return;
      }

      const dataUrl = chip.dataset.imageDataUrl;
      if (!dataUrl) {
        if (imagePreviewTimerRef.current) {
          clearTimeout(imagePreviewTimerRef.current);
          imagePreviewTimerRef.current = null;
        }
        setImagePreview(null);
        return;
      }

      if (imagePreviewTimerRef.current) {
        clearTimeout(imagePreviewTimerRef.current);
        imagePreviewTimerRef.current = null;
      }

      const rect = chip.getBoundingClientRect();
      const PREVIEW_MAX_W = 328;
      const halfW = PREVIEW_MAX_W / 2;
      const clampedX = Math.max(
        halfW + 4,
        Math.min(rect.left + rect.width / 2, window.innerWidth - halfW - 4)
      );
      setImagePreview({
        url: dataUrl,
        x: clampedX,
        y: rect.top,
      });
    },
    []
  );

  const handleChipRemove = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      const removeBtn = target.closest("[data-chip-remove='true']");
      if (!removeBtn) {
        return;
      }

      const chip = removeBtn.closest(".file-chip");
      if (chip && textareaRef.current?.contains(chip)) {
        chip.remove();
        syncContent();
      }
    },
    [syncContent, textareaRef]
  );

  const scheduleHideImagePreview = useCallback(() => {
    imagePreviewTimerRef.current = setTimeout(() => {
      setImagePreview(null);
    }, 200);
  }, []);

  const cancelHideImagePreview = useCallback(() => {
    if (imagePreviewTimerRef.current) {
      clearTimeout(imagePreviewTimerRef.current);
      imagePreviewTimerRef.current = null;
    }
  }, []);

  const handleSelectFilesAndFolders = useCallback(async () => {
    try {
      const selected = await window.snow.selectFiles(
        t("plusMenu.selectFilesTitle")
      );
      if (!selected || selected.length === 0) {
        return;
      }
      const tags: FileTag[] = selected.map((item) => {
        const path = item.path;
        const name = path.split("/").filter(Boolean).pop() || path;
        return { path, name, isDirectory: item.isDirectory };
      });
      insertFileTags(tags);
    } catch {
      // dialog cancelled or error
    }
  }, [insertFileTags, t]);

  const plusMenuSections = useMemo<PlusMenuSection[]>(
    () => [
      {
        id: "add",
        label: t("plusMenu.sectionAdd"),
        items: [
          {
            id: "files-and-folders",
            label: t("plusMenu.filesAndFolders"),
            icon: Paperclip,
            onSelect: () => void handleSelectFilesAndFolders(),
          },
        ],
      },
    ],
    [t, handleSelectFilesAndFolders]
  );

  const handleWithdrawPending = useCallback(
    (index: number): string | null => {
      const restored = onWithdrawPendingMessage?.(index);
      if (restored) {
        restoreContent(restored);
      }
      return restored ?? null;
    },
    [onWithdrawPendingMessage, restoreContent]
  );

  return (
    <div className="input-area" ref={mentionAnchorRef}>
      <FileMentionPopup
        ref={mentionPopupRef}
        visible={isMentionOpen}
        query={mentionQuery}
        onClose={handleCloseMention}
        onSelect={handleMentionSelect}
        onSelectBatch={handleMentionSelectBatch}
        textareaRef={textareaRef}
        onDragStart={handleMentionDragStart}
      />
      <PendingMessages
        messages={pendingMessages}
        onWithdraw={handleWithdrawPending}
      />
      <div className="input-box">
        <div
          ref={textareaRef}
          className="input-field input-field-editable"
          contentEditable
          suppressContentEditableWarning
          data-placeholder={placeholder}
          data-empty="true"
          onInput={handleInputWithMention}
          onKeyDown={handleMentionKeyDown}
          onPaste={handlePaste}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onMouseMove={showImagePreview}
          onMouseLeave={scheduleHideImagePreview}
          onClick={handleChipRemove}
        />
        {imagePreview &&
          createPortal(
            <div
              className="image-chip-preview"
              style={{
                left: imagePreview.x,
                top: imagePreview.y,
                transform: "translate(-50%, calc(-100% - 8px))",
              }}
              onMouseEnter={cancelHideImagePreview}
              onMouseLeave={scheduleHideImagePreview}
              onClick={() => {
                setImageLightbox(imagePreview.url);
                setImagePreview(null);
              }}
            >
              <img src={imagePreview.url} alt="preview" />
            </div>,
            document.body
          )}
        {imageLightbox &&
          createPortal(
            <div
              className="image-lightbox-overlay"
              onClick={() => setImageLightbox(null)}
            >
              <img src={imageLightbox} alt="fullscreen" />
            </div>,
            document.body
          )}
        <div className="input-toolbar">
          <div className="toolbar-left">
            <PlusMenu sections={plusMenuSections} />
          </div>
          <div className="toolbar-right">
            <div className="model-selector" ref={dropdownRef}>
              <button
                className={`toolbar-btn model ${
                  modelError ? "model-error" : ""
                }`}
                aria-label={labels.selectModel}
                aria-expanded={isDropdownOpen}
                onClick={handleToggleModelDropdown}
                type="button"
              >
                {modelError ? (
                  <AlertCircle size={14} className="model-icon" />
                ) : (
                  <Bot size={14} className="model-icon" />
                )}
                <span className="model-name" title={displayModel}>
                  {displayModel}
                </span>
                <ChevronDown size={12} />
              </button>
              {isDropdownOpen && (
                <div className={`model-dropdown drop-${modelDropdownDir}`}>
                  {isManualMode ? (
                    <div className="model-manual-input">
                      <div className="model-manual-header">
                        <Keyboard size={14} />
                        <span>{labels.manualModel}</span>
                      </div>
                      <input
                        autoFocus
                        value={manualValue}
                        onChange={(event) => setManualValue(event.target.value)}
                        onKeyDown={handleManualKeyDown}
                        placeholder={labels.manualModelPlaceholder}
                        className="model-manual-field"
                      />
                      <div className="model-manual-actions">
                        <button
                          className="model-manual-btn secondary"
                          onClick={() => setIsManualMode(false)}
                          type="button"
                        >
                          {labels.cancel}
                        </button>
                        <button
                          className="model-manual-btn primary"
                          onClick={() => void handleConfirmManualModel()}
                          disabled={!manualValue.trim()}
                          type="button"
                        >
                          {labels.confirm}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {isLoadingModels && (
                        <div
                          className="model-dropdown-status"
                          aria-live="polite"
                        >
                          <Loader2 size={14} className="spin" />
                          <span>{labels.loadingModels}</span>
                        </div>
                      )}
                      {modelError && (
                        <div className="model-dropdown-error">
                          <AlertCircle size={14} />
                          <span>{modelError}</span>
                          <button
                            className="model-dropdown-retry"
                            onClick={handleRetryFetchModels}
                            disabled={isLoadingModels}
                            type="button"
                          >
                            {labels.retry}
                          </button>
                        </div>
                      )}
                      <div className="model-dropdown-list">
                        {models.length === 0 &&
                          !modelError &&
                          !isLoadingModels && (
                            <div className="model-dropdown-empty">
                              {labels.noModelsFound}
                            </div>
                          )}
                        {models.map((model) => (
                          <button
                            key={model.id}
                            className={`model-dropdown-item ${
                              selectedModel === model.id ? "active" : ""
                            }`}
                            onClick={() => void handleSelectModel(model.id)}
                            type="button"
                            title={model.id}
                          >
                            <span className="model-dropdown-item-name">
                              {model.id}
                            </span>
                            {selectedModel === model.id && (
                              <Check
                                size={14}
                                className="model-dropdown-check"
                              />
                            )}
                          </button>
                        ))}
                      </div>
                      <div className="model-dropdown-footer model-dropdown-footer-actions">
                        <button
                          className="model-dropdown-action"
                          onClick={handleRetryFetchModels}
                          disabled={isLoadingModels}
                          title={labels.refreshModels}
                          type="button"
                        >
                          <RefreshCw size={14} />
                          <span>{labels.refreshModels}</span>
                        </button>
                        <button
                          className="model-dropdown-action"
                          onClick={handleOpenManualMode}
                          type="button"
                        >
                          <Keyboard size={14} />
                          <span>{labels.manualModel}</span>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
            <div className="thinking-selector" ref={thinkingDropdownRef}>
              <button
                className={`toolbar-btn quality ${
                  thinkingError ? "thinking-error" : ""
                }`}
                aria-label="Thinking strength"
                aria-expanded={isThinkingDropdownOpen}
                onClick={() => setIsThinkingDropdownOpen((open) => !open)}
                disabled={
                  !activeApiConfig || isLoadingApiConfig || isSavingThinking
                }
                title={
                  thinkingError ??
                  (isLoadingApiConfig
                    ? "Loading API configuration"
                    : `Thinking strength: ${thinkingLabel}`)
                }
                type="button"
              >
                {isLoadingApiConfig || isSavingThinking ? (
                  <Loader2 size={14} className="model-icon spin" />
                ) : thinkingError ? (
                  <AlertCircle size={14} className="model-icon" />
                ) : (
                  <ActiveThinkingIcon size={14} className="model-icon" />
                )}
                <span>{thinkingLabel}</span>
                <ChevronDown size={12} />
              </button>
              {isThinkingDropdownOpen && (
                <div
                  className={`model-dropdown thinking-dropdown drop-${thinkingDropdownDir}`}
                >
                  <div className="thinking-dropdown-header">
                    <span>Thinking strength</span>
                    <small>{requestMethod}</small>
                  </div>
                  <div className="model-dropdown-list">
                    {thinkingOptions.map((option) => {
                      const ThinkingOptionIcon = option.icon;

                      return (
                        <button
                          key={option.value}
                          className={`model-dropdown-item ${
                            thinkingValue === option.value ? "active" : ""
                          }`}
                          onClick={() =>
                            void handleSelectThinking(option.value)
                          }
                          type="button"
                        >
                          <span className="model-dropdown-item-name with-icon">
                            <ThinkingOptionIcon
                              size={14}
                              className="thinking-option-icon"
                            />
                            <span>{option.label}</span>
                          </span>
                          {thinkingValue === option.value && (
                            <Check size={14} className="model-dropdown-check" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            <TokenUsageRing
              tokenUsage={tokenUsage}
              maxContextTokens={activeApiConfig?.maxContextTokens ?? null}
            />
            <div className="input-action-buttons">
              {isStreaming || isAborting ? (
                <button
                  className={`abort-btn ${isAborting ? "is-aborting" : ""}`}
                  aria-label={
                    isAborting ? "Stopping generation" : "Stop generating"
                  }
                  title={isAborting ? "Stopping generation" : "Stop generating"}
                  onClick={handleAbort}
                  disabled={isAborting}
                  type="button"
                >
                  {isAborting ? (
                    <Loader2 size={14} className="spin" />
                  ) : (
                    <Square size={14} fill="currentColor" />
                  )}
                </button>
              ) : (
                <span className="abort-btn-placeholder" aria-hidden="true" />
              )}
              <button
                className="send-btn"
                aria-label="Send"
                title="Send"
                onClick={handleSend}
                disabled={!value.trim()}
                type="button"
              >
                <ArrowUp size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
