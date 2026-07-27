import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, FolderOpen, Loader2 } from "lucide-react";
import type { DetectedTerminalOption } from "./types";

type TerminalComboboxProps = {
  value: string;
  placeholder: string;
  disabled: boolean;
  isSelectingExecutable: boolean;
  detectedTerminals: DetectedTerminalOption[];
  browseLabel: string;
  emptyText: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  onBrowse: () => void;
};

export function TerminalCombobox({
  value,
  placeholder,
  disabled,
  isSelectingExecutable,
  detectedTerminals,
  browseLabel,
  emptyText,
  onChange,
  onBlur,
  onBrowse,
}: TerminalComboboxProps): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [isOpen]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [value, detectedTerminals]);

  const filteredTerminals = detectedTerminals.filter((terminal) => {
    const keyword = value.trim().toLowerCase();
    if (!keyword) {
      return true;
    }
    return (
      terminal.name.toLowerCase().includes(keyword) ||
      terminal.path.toLowerCase().includes(keyword)
    );
  });

  const openDropdown = () => {
    if (!disabled) {
      setIsOpen(true);
    }
  };

  const handleSelect = (path: string) => {
    onChange(path);
    setIsOpen(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setIsOpen(false);
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      openDropdown();
      setHighlightedIndex((index) =>
        Math.min(index + 1, Math.max(filteredTerminals.length - 1, 0))
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((index) => Math.max(index - 1, 0));
      return;
    }

    if (event.key === "Enter" && isOpen && filteredTerminals[highlightedIndex]) {
      event.preventDefault();
      handleSelect(filteredTerminals[highlightedIndex].path);
    }
  };

  return (
    <div className="api-settings-field terminal-combobox-field">
      <div className="terminal-combobox" ref={rootRef}>
        <div className="terminal-combobox-input-wrap">
          <input
            value={value}
            onChange={(event) => {
              onChange(event.target.value);
              openDropdown();
            }}
            onFocus={openDropdown}
            onClick={openDropdown}
            onKeyDown={handleKeyDown}
            onBlur={onBlur}
            placeholder={placeholder}
            disabled={disabled}
            role="combobox"
            aria-expanded={isOpen}
            aria-autocomplete="list"
          />
          <span
            className="terminal-combobox-toggle"
            onClick={openDropdown}
            aria-hidden="true"
          >
            <ChevronDown size={14} />
          </span>
        </div>

        {isOpen && !disabled && (
          <div className="terminal-combobox-menu" role="listbox">
            {filteredTerminals.length > 0 ? (
              <div className="terminal-combobox-list">
                {filteredTerminals.map((terminal, index) => {
                  const isSelected = terminal.path === value;
                  const isHighlighted = index === highlightedIndex;

                  return (
                    <button
                      key={terminal.path}
                      type="button"
                      className={`terminal-combobox-option ${
                        isSelected ? "selected" : ""
                      } ${isHighlighted ? "highlighted" : ""}`}
                      onMouseEnter={() => setHighlightedIndex(index)}
                      onClick={() => handleSelect(terminal.path)}
                      role="option"
                      aria-selected={isSelected}
                      title={terminal.path}
                    >
                      <span className="terminal-combobox-option-info">
                        <span className="terminal-combobox-option-name">
                          {terminal.name}
                        </span>
                        <span className="terminal-combobox-option-path">
                          {terminal.path}
                        </span>
                      </span>
                      {isSelected && <Check size={14} />}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="terminal-combobox-empty">{emptyText}</div>
            )}

            <button
              type="button"
              className="terminal-combobox-browse"
              onClick={() => {
                setIsOpen(false);
                onBrowse();
              }}
              disabled={disabled}
            >
              {isSelectingExecutable ? (
                <Loader2 size={14} className="terminal-combobox-spin" />
              ) : (
                <FolderOpen size={14} strokeWidth={1.9} />
              )}
              <span>{browseLabel}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
