import { ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useI18n } from "../../../../i18n";

type ToolCallGroupProps = {
  /** Number of tool calls in this group. */
  count: number;
  /** Whether any tool in the group is still running. */
  isRunning?: boolean;
  /** The tool call nodes. */
  children: ReactNode;
};

export const ToolCallGroup = ({
  count,
  isRunning = false,
  children,
}: ToolCallGroupProps): React.JSX.Element => {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(true);

  const label = isRunning
    ? t("toolCall.group.runningSteps", {
        defaultValue: "{{count}} steps",
        values: { count },
      })
    : t("toolCall.group.steps", {
        defaultValue: "{{count}} steps",
        values: { count },
      });

  return (
    <div className="tcg">
      <button
        type="button"
        className="tcg-toggle"
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
      >
        <span className="tcg-label">{label}</span>
        <ChevronRight
          className={`tcg-chevron ${isOpen ? "tcg-chevron--open" : ""}`}
          size={12}
          aria-hidden="true"
        />
      </button>
      {isOpen ? <div className="tcg-list">{children}</div> : null}
    </div>
  );
};
