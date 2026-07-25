/**
 * Plan Mode hard gate for Snow App.
 *
 * When planMode is on and the current session has not been explicitly approved,
 * block mutating tool side-effects. Read-only tools and writes under
 * `.snow/plan/**` remain allowed.
 *
 * This mirrors snow-cli's source/utils/execution/planModeGate.ts, adapted for
 * Snow App's MCP tool naming convention (`<server>-<tool>`).
 */

/** Tools that are always allowed regardless of plan approval status. */
const ALWAYS_ALLOW_EXACT = new Set<string>([
  "user-interaction-askUserQuestion",
  "ace-ace-search",
  "codebase-codebase-search",
  "filesystem-filesystem-read",
  "ide-ide-get_diagnostics",
  "todo-todo-manage",
  "todo-todo-ultra",
  "notebook-notebook-manage",
  "skill-skill-execute",
  "websearch-websearch-search",
  "websearch-websearch-fetch",
  "snow-docs-snow-docs-list",
  "snow-docs-snow-docs-search",
  "snow-docs-snow-docs-get",
]);

/** Prefixes for tools that are always allowed (read-only / search). */
const ALWAYS_ALLOW_PREFIXES = [
  "ace-",
  "websearch-",
  "snow-docs-",
  "codebase-",
];

/** Filesystem write tool names. */
const FILESYSTEM_WRITE_TOOLS = new Set<string>([
  "filesystem-filesystem-create",
  "filesystem-filesystem-edit",
  "filesystem-filesystem-replaceedit",
]);

/** Tools that are always blocked while plan is unapproved. */
const BLOCKED_TOOLS = new Set<string>([
  "bash-terminal-execute",
  "sub-agents-activate",
]);

/**
 * Check if a tool is always allowed (read-only / search / user interaction).
 */
function isAlwaysAllowTool(toolName: string): boolean {
  if (ALWAYS_ALLOW_EXACT.has(toolName)) {
    return true;
  }
  return ALWAYS_ALLOW_PREFIXES.some((prefix) => toolName.startsWith(prefix));
}

/**
 * Check if a tool is a terminal/shell execution tool.
 */
function isTerminalLikeTool(toolName: string): boolean {
  if (toolName === "bash-terminal-execute") {
    return true;
  }
  if (toolName.includes("terminal") || toolName.includes("bash")) {
    return true;
  }
  return false;
}

/**
 * Collect filesystem target paths from tool args (single / batch).
 */
function collectFilesystemPaths(args: unknown): string[] {
  if (!args || typeof args !== "object") {
    return [];
  }

  const obj = args as Record<string, unknown>;
  const filePath = obj.filePath ?? obj.path;
  if (typeof filePath === "string" && filePath.trim()) {
    return [filePath];
  }

  if (Array.isArray(filePath)) {
    const paths: string[] = [];
    for (const item of filePath) {
      if (typeof item === "string" && item.trim()) {
        paths.push(item);
        continue;
      }
      if (item && typeof item === "object") {
        const p = (item as Record<string, unknown>).path ??
          (item as Record<string, unknown>).filePath;
        if (typeof p === "string" && p.trim()) {
          paths.push(p);
        }
      }
    }
    return paths;
  }

  return [];
}

/**
 * Normalize a file path for comparison.
 */
function normalizePathForCompare(filePath: string): string {
  return filePath.replace(/\\/g, "/").toLowerCase();
}

/**
 * Check if a path is inside `.snow/plan/` (allowed write target while unapproved).
 */
function isPlanDirPath(filePath: string): boolean {
  const normalized = normalizePathForCompare(filePath);
  return normalized.includes("/.snow/plan/") || normalized.endsWith("/.snow/plan") ||
    normalized === ".snow/plan" || normalized.startsWith(".snow/plan/");
}

/**
 * Check if a path is inside `.trellis/tasks/` (allowed write target while unapproved).
 */
function isTrellisTasksDirPath(filePath: string): boolean {
  const normalized = normalizePathForCompare(filePath);
  return normalized.includes("/.trellis/tasks/") || normalized.endsWith("/.trellis/tasks") ||
    normalized === ".trellis/tasks" || normalized.startsWith(".trellis/tasks/");
}

/**
 * Check if a write path is allowed while plan is unapproved.
 */
function isAllowedUnapprovedWritePath(filePath: string): boolean {
  return isPlanDirPath(filePath) || isTrellisTasksDirPath(filePath);
}

/**
 * Classify whether a tool call should be allowed or blocked by the Plan gate.
 *
 * Returns 'allow' if the tool can proceed, 'block' if it should be rejected.
 */
export function classifyPlanGateDecision(
  toolName: string,
  args: unknown,
): "allow" | "block" {
  // Always-allow tools (read, search, user interaction, etc.)
  if (isAlwaysAllowTool(toolName)) {
    return "allow";
  }

  // Sub-agent activation — block while unapproved
  if (toolName === "sub-agents-activate") {
    return "block";
  }

  // Terminal/shell tools — block while unapproved
  if (isTerminalLikeTool(toolName)) {
    return "block";
  }

  // Filesystem write tools — check if writing to allowed planning paths
  if (FILESYSTEM_WRITE_TOOLS.has(toolName)) {
    const paths = collectFilesystemPaths(args);
    if (paths.length === 0) {
      return "block";
    }
    const allAllowed = paths.every((p) => isAllowedUnapprovedWritePath(p));
    return allAllowed ? "allow" : "block";
  }

  // Obvious mutating names (external MCP tools)
  const lower = toolName.toLowerCase();
  if (
    lower.includes("write") ||
    lower.includes("delete") ||
    lower.includes("remove") ||
    lower.includes("unlink")
  ) {
    return "block";
  }

  // Default allow for unknown read-ish MCP tools (usability)
  return "allow";
}

/**
 * Build the block message for a tool rejected by the Plan gate.
 */
export function buildPlanGateBlockMessage(toolName: string): string {
  return (
    `Error: Plan Mode gate is active (plan not approved yet). ` +
    `Blocked tool: ${toolName}. ` +
    `You may only read/search and write files under .snow/plan/** or .trellis/tasks/**. ` +
    `Create or update the plan, then call askUserQuestion and get explicit approval ` +
    `(e.g. "Yes - Execute the entire plan") before modifying code or running commands.`
  );
}

/**
 * Evaluate the Plan gate for a tool call.
 *
 * Returns `{ allow: true }` if the tool can proceed, or
 * `{ allow: false, message }` if it should be blocked.
 */
export function evaluatePlanGate(input: {
  planMode: boolean;
  planApproved: boolean;
  toolName: string;
  args: unknown;
}): { allow: boolean; message?: string } {
  if (!input.planMode) {
    return { allow: true };
  }

  if (input.planApproved) {
    return { allow: true };
  }

  // Always allow the approval tool itself
  if (input.toolName === "user-interaction-askUserQuestion") {
    return { allow: true };
  }

  const decision = classifyPlanGateDecision(input.toolName, input.args);

  if (decision === "allow") {
    return { allow: true };
  }

  return {
    allow: false,
    message: buildPlanGateBlockMessage(input.toolName),
  };
}

/**
 * Detect explicit plan-execution approval from askUserQuestion results.
 *
 * Checks the tool result (JSON string) for approval signals.
 */
export function isPlanApprovalResult(
  toolName: string,
  result: string,
): boolean {
  if (toolName !== "user-interaction-askUserQuestion") {
    return false;
  }

  try {
    const parsed = JSON.parse(result) as Record<string, unknown>;
    const selected = parsed.selectedOptions;
    const options: string[] = Array.isArray(selected)
      ? selected.filter((s): s is string => typeof s === "string")
      : [];

    if (options.length === 0) {
      return false;
    }

    const normalized = options.map((opt) =>
      opt.trim().toLowerCase().replace(/\s+/g, " "),
    );

    for (const opt of normalized) {
      // Explicit reject / review / modify
      if (
        opt.includes("review") ||
        opt.includes("modify") ||
        opt.includes("cancel") ||
        opt.includes("reject")
      ) {
        return false;
      }

      // Full / explicit approval phrases
      if (
        opt.includes("execute the entire plan") ||
        opt.includes("execute entire plan") ||
        opt.includes("yes - execute") ||
        opt.includes("yes-execute") ||
        opt === "yes" ||
        opt === "ok" ||
        opt === "approve" ||
        opt === "approved"
      ) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}
