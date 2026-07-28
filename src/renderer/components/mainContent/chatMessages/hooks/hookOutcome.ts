import type { HookExecuteResult } from "../../../../../preload";

/**
 * Unified interpretation of a hook execution result based on exit-code semantics:
 *
 * - exit 0  → pass:  stdout becomes `additionalContext` (and raw `output`);
 *            for interactive tools the raw output can serve as the tool result.
 * - exit 1  → warn:  carry the command's output/error as a warning message;
 *            if the command produced nothing, fall back to a built-in notice.
 * - exit 2+ → abort: the AI loop must be fully interrupted and cancelled,
 *            surfacing the hook's error message.
 */
export type HookOutcome =
  | { kind: "pass"; context: string | null; output: string | null }
  | { kind: "warn"; message: string }
  | { kind: "abort"; message: string };

const UNKNOWN_WARNING = "Hooks有未知警告";
const UNKNOWN_BLOCK = "Hook blocked the action";

export const resolveHookOutcome = (
  result: HookExecuteResult
): HookOutcome => {
  if (result.blocked) {
    return {
      kind: "abort",
      message: result.blockMessage || UNKNOWN_BLOCK,
    };
  }

  if (result.softSignal) {
    const warning = result.results
      .map((record) => record.output || record.error)
      .filter((value): value is string => Boolean(value))
      .join("\n")
      .trim();
    return {
      kind: "warn",
      message: warning || UNKNOWN_WARNING,
    };
  }

  const context = result.results
    .map((record) => record.additionalContext)
    .filter((value): value is string => Boolean(value))
    .join("\n")
    .trim();

  const output =
    result.results
      .map((record) => record.output)
      .find((value): value is string => Boolean(value)) ?? null;

  return {
    kind: "pass",
    context: context || null,
    output,
  };
};
