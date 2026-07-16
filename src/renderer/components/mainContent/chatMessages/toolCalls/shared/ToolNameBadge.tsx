import {
  FileText,
  FilePen,
  FilePlus,
  Wrench,
  Search,
  Terminal,
  Globe,
  GitBranch,
  ListTree,
  ListChecks,
  MessageCircleQuestion,
  Hammer,
  type LucideIcon,
} from "lucide-react";

export type ToolCategory =
  | "read"
  | "edit"
  | "create"
  | "search"
  | "terminal"
  | "web"
  | "git"
  | "outline"
  | "todo"
  | "interaction"
  | "generic";

const TOOL_ICON_MAP: Record<ToolCategory, LucideIcon> = {
  read: FileText,
  edit: FilePen,
  create: FilePlus,
  search: Search,
  terminal: Terminal,
  web: Globe,
  git: GitBranch,
  outline: ListTree,
  todo: ListChecks,
  interaction: MessageCircleQuestion,
  generic: Wrench,
};

/**
 * Map a raw MCP tool name to a display category for icon selection.
 *
 * Examples:
 *   "mcp__filesystem__read"       -> "read"
 *   "mcp__filesystem__replace_edit" -> "edit"
 *   "mcp__filesystem__create"      -> "create"
 *   "ace-search"                   -> "search"
 *   "terminal-execute"             -> "terminal"
 *   "websearch-search"             -> "web"
 *   "todo-manage"                  -> "generic"
 */
export const getToolCategory = (toolName: string): ToolCategory => {
  const lower = toolName.toLowerCase();
  if (lower.includes("read")) return "read";
  if (lower.includes("edit") || lower.includes("replace")) return "edit";
  if (lower.includes("create") || lower.includes("write")) return "create";
  if (
    lower.includes("search") ||
    lower.includes("find") ||
    lower.includes("semantic")
  )
    return "search";
  if (
    lower.includes("terminal") ||
    lower.includes("execute") ||
    lower.includes("command")
  )
    return "terminal";
  if (lower.includes("web") || lower.includes("fetch") || lower.includes("url"))
    return "web";
  if (lower.includes("git")) return "git";
  if (
    lower.includes("outline") ||
    lower.includes("tree") ||
    lower.includes("symbol")
  )
    return "outline";
  if (lower.includes("todo")) return "todo";
  if (lower.includes("question") || lower.includes("interaction")) {
    return "interaction";
  }
  return "generic";
};

type ToolNameBadgeProps = {
  /** The display name shown in the badge, e.g. "read", "edit", "create". */
  name: string;
  /** Explicit category override; if omitted it is inferred from `name`. */
  category?: ToolCategory;
};

export const ToolNameBadge = ({
  name,
  category,
}: ToolNameBadgeProps): React.JSX.Element => {
  const cat = category ?? getToolCategory(name);
  const Icon = TOOL_ICON_MAP[cat] ?? Hammer;

  return (
    <span className="tool-call-tool-name">
      <Icon size={10} className="tool-call-tool-name-icon" aria-hidden="true" />
      {name}
    </span>
  );
};
