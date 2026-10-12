export type ToolRejection = {
  reason: string;
  userProvided: boolean;
};

export const DEFAULT_TOOL_REJECTION_REASON = "User declined tool execution";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const parseToolRejection = (
  result: string | undefined,
): ToolRejection | null => {
  if (!result) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(result);
    if (!isRecord(parsed) || parsed.error !== "TOOL_EXECUTION_DENIED") {
      return null;
    }

    const reason =
      typeof parsed.reason === "string" ? parsed.reason.trim() : "";
    return {
      reason,
      userProvided:
        reason.length > 0 && reason !== DEFAULT_TOOL_REJECTION_REASON,
    };
  } catch {
    return null;
  }
};
