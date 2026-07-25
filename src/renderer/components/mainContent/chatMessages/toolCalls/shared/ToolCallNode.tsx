import { ChevronRight, Loader2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { ToolCategory } from "./ToolNameBadge";
import { ToolNameBadge } from "./ToolNameBadge";

type ToolCallNodeProps = {
  /** Raw MCP tool name (e.g. "mcp__filesystem__read") or short name. */
  toolName: string;
  /** Badge display name (e.g. "read", "edit"). Falls back to parsed short name. */
  badgeName?: string;
  /** Badge category. Inferred from toolName if omitted. */
  category?: ToolCategory;
  /** Context label shown after the badge (e.g. filename, command). Accepts ReactNode for rich content like file icons. */
  displayName?: ReactNode;
  /** Tooltip text for the displayName area. Only used when displayName is set. */
  displayNameTitle?: string;
  /** Current status of the tool call. */
  status: "pending" | "running" | "completed" | "error";
  /** Whether the node is expanded by default. */
  defaultOpen?: boolean;
  /** Extra metadata rendered inline in the header (badges, counts, etc.). */
  meta?: ReactNode;
  /** Additional CSS class on the outer <details>. */
  className?: string;
  /** Body content shown when expanded. */
  children?: ReactNode;
};

/**
 * Parse "mcp__filesystem__read" -> "read".
 * Non-MCP names are returned as-is.
 */
const shortName = (name: string): string => name.replace(/^mcp__.*?__/, "");

export const ToolCallNode = ({
  toolName,
  badgeName,
  category,
  displayName,
  displayNameTitle,
  status,
  defaultOpen = false,
  meta,
  className,
  children,
}: ToolCallNodeProps): React.JSX.Element => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const isRunning = status === "running";

  const resolvedBadgeName = badgeName ?? shortName(toolName);

  const dotClass =
    status === "completed"
      ? "tcn-dot--completed"
      : status === "running"
      ? "tcn-dot--running"
      : status === "error"
      ? "tcn-dot--error"
      : "tcn-dot--pending";

  return (
    <details
      className={`tcn ${className ?? ""}`}
      open={isOpen}
      onToggle={(e) => setIsOpen(e.currentTarget.open)}
    >
      <summary className="tcn-header">
        <span className={`tcn-dot ${dotClass}`} aria-hidden="true" />
        {isRunning ? (
          <Loader2 size={13} className="tcn-icon-spin" aria-hidden="true" />
        ) : (
          <ToolNameBadge name={resolvedBadgeName} category={category} />
        )}
        {displayName ? (
          <>
            <span className="tcn-sep" aria-hidden="true">
              /
            </span>
            <span className="tcn-name" title={displayNameTitle}>
              {displayName}
            </span>
          </>
        ) : null}
        {meta ? <span className="tcn-meta">{meta}</span> : null}
        <ChevronRight className="tcn-chevron" size={12} aria-hidden="true" />
      </summary>
      {children ? <div className="tcn-body">{children}</div> : null}
    </details>
  );
};
