import { Loader2, MessageSquareMore, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useI18n } from "../../i18n";
import type { ConversationSearchResult } from "../../../preload";
import { Modal } from "../common/Modal";
import { formatTimeLabel, parseDbTimestamp } from "./mainSidebar/chatTimeGroup";

type SearchModalProps = {
  open: boolean;
  onClose: () => void;
  onSelect: (conversation: ConversationSearchResult) => void;
};

export function SearchModal({
  open,
  onClose,
  onSelect,
}: SearchModalProps): React.JSX.Element {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ConversationSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setHasSearched(false);
      setActiveIndex(0);
      const id = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [open]);

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    const trimmed = query.trim();

    if (!trimmed) {
      setResults([]);
      setHasSearched(false);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const currentRequestId = ++requestIdRef.current;

    debounceRef.current = setTimeout(async () => {
      try {
        const items = await window.snow.searchChatConversations(trimmed);
        if (currentRequestId === requestIdRef.current) {
          setResults(items);
          setActiveIndex(0);
          setHasSearched(true);
        }
      } catch {
        if (currentRequestId === requestIdRef.current) {
          setResults([]);
          setHasSearched(true);
        }
      } finally {
        if (currentRequestId === requestIdRef.current) {
          setIsLoading(false);
        }
      }
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query]);

  const handleSelect = (conversation: ConversationSearchResult): void => {
    onSelect(conversation);
    onClose();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (results.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((prev) => (prev + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((prev) => (prev === 0 ? results.length - 1 : prev - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const target = results[activeIndex];
      if (target) {
        handleSelect(target);
      }
    }
  };

  const now = new Date();

  const renderBody = (): React.ReactNode => {
    if (isLoading) {
      return (
        <div className="search-modal-loading">
          <Loader2 className="spin" size={18} />
          <span>{t("search.searching", { defaultValue: "Searching..." })}</span>
        </div>
      );
    }

    if (!hasSearched) {
      return (
        <div className="search-modal-hint">
          {t("search.hint", {
            defaultValue: "Type to search conversations",
          })}
        </div>
      );
    }

    if (results.length === 0) {
      return (
        <div className="search-modal-empty">
          {t("search.noResults", { defaultValue: "No results found" })}
        </div>
      );
    }

    return (
      <div className="search-modal-results" onKeyDown={handleKeyDown}>
        {results.map((conversation, index) => {
          const displayName =
            conversation.summary ||
            conversation.title ||
            t("sidebar.untitledChat", { defaultValue: "Untitled" });
          const parsedDate = parseDbTimestamp(conversation.updatedAt);
          const timeLabel = formatTimeLabel(parsedDate, now);

          return (
            <div
              key={conversation.conversationId}
              className={`search-result-item${
                index === activeIndex ? " active" : ""
              }`}
              onClick={() => handleSelect(conversation)}
              onMouseEnter={() => setActiveIndex(index)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  handleSelect(conversation);
                }
              }}
            >
              <span className="search-result-icon">
                <MessageSquareMore size={14} />
              </span>
              <div className="search-result-content">
                <div className="search-result-title">{displayName}</div>
                {conversation.matchedContent && (
                  <div className="search-result-preview">
                    {conversation.matchedContent}
                  </div>
                )}
              </div>
              <span className="search-result-time">{timeLabel}</span>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <Modal
      open={open}
      title={t("search.title", { defaultValue: "Search" })}
      closeLabel={t("search.close", { defaultValue: "Close search" })}
      onClose={onClose}
      size="large"
      className="search-modal"
    >
      <div className="search-modal-input-wrapper">
        <Search size={16} className="search-modal-input-icon" />
        <input
          ref={inputRef}
          className="search-modal-input"
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("search.placeholder", {
            defaultValue: "Search conversations...",
          })}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <div className="search-modal-body">{renderBody()}</div>
    </Modal>
  );
}
