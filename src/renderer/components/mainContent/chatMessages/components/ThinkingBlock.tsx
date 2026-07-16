import { ChevronDown, ChevronRight, ChevronUp, Loader2 } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useI18n } from "../../../../i18n";
import { MarkdownBlock } from "./markdownRenderer";

/** Fixed height (px) for the collapsed thinking content area. */
const THINKING_FIXED_HEIGHT = 200;

type ThinkingBlockProps = {
  content: string;
  isStreaming?: boolean;
};

export const ThinkingBlock = ({
  content,
  isStreaming = false,
}: ThinkingBlockProps): React.JSX.Element => {
  const { t } = useI18n();

  // Whether the entire thinking section is collapsed (header-only)
  const [isCollapsed, setIsCollapsed] = useState(false);
  // Whether the content is fully expanded (no height limit)
  const [isExpanded, setIsExpanded] = useState(false);
  // Whether content overflows the fixed height (controls mask visibility)
  const [isOverflow, setIsOverflow] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  // Tracks whether auto-scroll should be active (user hasn't scrolled away)
  const autoScrollRef = useRef(true);

  // Auto-scroll to bottom during streaming
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !isStreaming) return;
    if (autoScrollRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [content, isStreaming]);

  // Reset auto-scroll when streaming starts
  useEffect(() => {
    if (isStreaming) {
      autoScrollRef.current = true;
    }
  }, [isStreaming]);

  // Check if content overflows the fixed height
  const checkOverflow = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setIsOverflow(el.scrollHeight > THINKING_FIXED_HEIGHT);
  }, []);

  useLayoutEffect(() => {
    checkOverflow();
  }, [content, checkOverflow]);

  // Re-check on resize
  useEffect(() => {
    const handleResize = () => checkOverflow();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [checkOverflow]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    autoScrollRef.current = isNearBottom;
  }, []);

  const handleToggleCollapse = useCallback(() => {
    setIsCollapsed((v) => !v);
  }, []);

  const handleToggleExpand = useCallback(() => {
    setIsExpanded((v) => !v);
  }, []);

  const handleHeaderKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setIsCollapsed((v) => !v);
    }
  }, []);

  return (
    <div className="thinking-block">
      <div
        className="thinking-block-header"
        onClick={handleToggleCollapse}
        onKeyDown={handleHeaderKeyDown}
        role="button"
        tabIndex={0}
        aria-expanded={!isCollapsed}
      >
        <ChevronRight
          className={`thinking-block-chevron${
            !isCollapsed ? " thinking-block-chevron--open" : ""
          }`}
          size={16}
          aria-hidden="true"
        />
        <span>{t("chat.thinkingProcess")}</span>
        {isStreaming ? (
          <Loader2
            size={12}
            className="thinking-block-spinner spin"
            aria-hidden="true"
          />
        ) : null}
      </div>

      {!isCollapsed ? (
        <div className="thinking-block-content-wrapper">
          <div
            className={`thinking-block-scroll${
              isExpanded ? " thinking-block-scroll--expanded" : ""
            }`}
            ref={scrollRef}
            onScroll={handleScroll}
          >
            <MarkdownBlock className="thinking-block-body" content={content} />
          </div>

          {isOverflow && !isExpanded ? (
            <div className="thinking-block-mask">
              <button
                type="button"
                className="thinking-block-expand-btn"
                onClick={handleToggleExpand}
              >
                <ChevronDown size={14} aria-hidden="true" />
                <span>{t("chat.expandAll")}</span>
              </button>
            </div>
          ) : null}

          {isExpanded ? (
            <button
              type="button"
              className="thinking-block-collapse-btn"
              onClick={handleToggleExpand}
            >
              <ChevronUp size={14} aria-hidden="true" />
              <span>{t("chat.collapse")}</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
