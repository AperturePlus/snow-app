import { useState, useRef, useCallback, useLayoutEffect } from "react";
import { Plus, Hand, ChevronDown, ArrowUp, Zap } from "lucide-react";

type ChatInputProps = {
  placeholder?: string;
  onSend?: (message: string) => void;
};

const MAX_TEXTAREA_ROWS = 8;
const DEFAULT_TEXTAREA_ROWS = 3;

export const ChatInput = ({
  placeholder = "Ask for follow-up changes",
  onSend,
}: ChatInputProps): React.JSX.Element => {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = "auto";
    const lineHeight =
      parseInt(getComputedStyle(textarea).lineHeight, 10) || 20;
    const minHeight = lineHeight * DEFAULT_TEXTAREA_ROWS;
    const maxHeight = lineHeight * MAX_TEXTAREA_ROWS;
    textarea.style.height = `${Math.min(
      Math.max(textarea.scrollHeight, minHeight),
      maxHeight
    )}px`;
  }, []);

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      setValue(event.target.value);
      adjustHeight();
    },
    [adjustHeight]
  );

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }

    onSend?.(trimmed);
    setValue("");

    const textarea = textareaRef.current;
    if (textarea) {
      requestAnimationFrame(() => {
        adjustHeight();
      });
    }
  }, [value, onSend, adjustHeight]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== "Enter") {
        return;
      }

      if (event.shiftKey) {
        return;
      }

      event.preventDefault();
      handleSend();
    },
    [handleSend]
  );

  useLayoutEffect(() => {
    adjustHeight();
  }, [adjustHeight]);

  return (
    <div className="input-area">
      <div className="input-box">
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          placeholder={placeholder}
          className="input-field"
          onChange={handleChange}
          onKeyDown={handleKeyDown}
        />
      </div>
      <div className="input-toolbar">
        <div className="toolbar-left">
          <button className="toolbar-btn" aria-label="Add attachment">
            <Plus size={16} />
          </button>
          <button className="toolbar-btn permissions" aria-label="Permissions">
            <Hand size={14} />
            <span>Default permissions</span>
            <ChevronDown size={12} />
          </button>
        </div>
        <div className="toolbar-right">
          <button className="toolbar-btn model" aria-label="Model">
            <Zap size={14} className="model-icon" />
            <span>GPT-5.4</span>
            <ChevronDown size={12} />
          </button>
          <button className="toolbar-btn quality" aria-label="Quality">
            <span>Extra High</span>
            <ChevronDown size={12} />
          </button>
          <button
            className="send-btn"
            aria-label="Send"
            onClick={handleSend}
            disabled={!value.trim()}
          >
            <ArrowUp size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};
