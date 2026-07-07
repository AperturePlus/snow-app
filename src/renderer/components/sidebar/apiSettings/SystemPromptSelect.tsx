import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { useI18n } from "../../../i18n";
import type { SystemPromptItemRecord } from "../../../../preload";

type SystemPromptSelectProps = {
  value: string;
  prompts: SystemPromptItemRecord[];
  onChange: (value: string) => void;
  disabled?: boolean;
};

export function SystemPromptSelect({
  value,
  prompts,
  onChange,
  disabled = false,
}: SystemPromptSelectProps): React.JSX.Element {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const isPromptDisabled = value.trim() === "__DISABLED__";

  const selectedIds = (() => {
    const raw = value.trim();
    if (!raw || raw === "__DISABLED__") return [] as string[];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter((v): v is string => typeof v === "string")
        : [];
    } catch {
      return [];
    }
  })();

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const handleToggle = useCallback(
    (promptId: string) => {
      const next = new Set(selectedIds);
      if (next.has(promptId)) {
        next.delete(promptId);
      } else {
        next.add(promptId);
      }
      const ids = Array.from(next);
      onChange(ids.length > 0 ? JSON.stringify(ids) : "");
    },
    [selectedIds, onChange]
  );

  const handleSetMode = useCallback(
    (mode: "follow" | "disabled") => {
      onChange(mode === "disabled" ? "__DISABLED__" : "");
      setIsOpen(false);
    },
    [onChange]
  );

  const displayText = isPromptDisabled
    ? t("settings.apiSystemPromptsDisabled", {
        defaultValue: "Do not use",
      })
    : selectedIds.length === 0
    ? t("settings.apiSystemPromptsFollowGlobal", {
        defaultValue: "Follow global (inherit)",
      })
    : selectedIds
        .map((id) => prompts.find((p) => p.promptId === id)?.name || id)
        .join(", ");

  return (
    <div className="custom-select" ref={containerRef}>
      <button
        type="button"
        className="custom-select-trigger"
        onClick={() => !disabled && setIsOpen((v) => !v)}
        disabled={disabled}
      >
        <span className="custom-select-label" title={displayText}>
          {displayText}
        </span>
        <ChevronDown size={14} />
      </button>
      {isOpen && (
        <div className="custom-select-dropdown">
          <button
            type="button"
            className="custom-select-item"
            onClick={() => handleSetMode("follow")}
          >
            <span>
              {t("settings.apiSystemPromptsFollowGlobal", {
                defaultValue: "Follow global (inherit)",
              })}
            </span>
            {!isPromptDisabled && selectedIds.length === 0 && (
              <Check size={14} className="custom-select-check" />
            )}
          </button>
          <button
            type="button"
            className="custom-select-item"
            onClick={() => handleSetMode("disabled")}
          >
            <span>
              {t("settings.apiSystemPromptsDisabled", {
                defaultValue: "Do not use",
              })}
            </span>
            {isPromptDisabled && (
              <Check size={14} className="custom-select-check" />
            )}
          </button>
          {prompts.length === 0 ? (
            <div className="custom-select-empty">
              {t("settings.apiNoSystemPrompts", {
                defaultValue: "No system prompts configured.",
              })}
            </div>
          ) : (
            prompts.map((prompt) => (
              <button
                key={prompt.promptId}
                type="button"
                className="custom-select-item"
                onClick={() => handleToggle(prompt.promptId)}
              >
                <span>{prompt.name || prompt.promptId}</span>
                {selectedIds.includes(prompt.promptId) && (
                  <Check size={14} className="custom-select-check" />
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
