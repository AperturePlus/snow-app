import type { NativePromptOptimizationResult } from "../../native/types";
import type {
  PromptContextReport,
  PromptOptimizationResult,
} from "../../../preload/types/promptOptimization";
import { contextObject, contextString } from "./promptContextHost";
const number = (value: unknown): number => {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 100000000
  )
    throw new Error("Invalid project context count");
  return value;
};
const code = (value: unknown): string => {
  const text = contextString(value)!;
  if (!/^[a-zA-Z0-9_.:-]{1,128}$/.test(text))
    throw new Error("Invalid project context reason");
  return text;
};
const warnings = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.length > 64)
    throw new Error("Invalid project context warnings");
  return value.map(code);
};
const parse = (value: string): unknown => {
  if (typeof value !== "string" || value.length > 100000)
    throw new Error("Invalid project context response");
  return JSON.parse(value);
};
export const sanitizePromptOptimizationResult = (
  result: NativePromptOptimizationResult,
): PromptOptimizationResult => {
  if (typeof result.content !== "string" || result.content.length > 100000)
    throw new Error("Invalid optimization result");
  const output: PromptOptimizationResult = { content: result.content };
  if (result.contextReportJson) {
    const v = contextObject(parse(result.contextReportJson));
    if (
      !["used", "skipped", "degraded", "review_required"].includes(
        String(v.outcome),
      ) ||
      !["fresh", "stale", "indexing", "unknown", "unavailable"].includes(
        String(v.indexState),
      ) ||
      !["exact", "semantic", "mixed", "none"].includes(String(v.queryKind)) ||
      typeof v.cacheHit !== "boolean" ||
      typeof v.truncated !== "boolean" ||
      !Array.isArray(v.sources) ||
      v.sources.length > 64
    )
      throw new Error("Invalid project context report");
    const sources = v.sources.map((item) => {
      const s = contextObject(item);
      const path = contextString(s.path)!;
      if (
        /^[\\/]|^[a-z]:/i.test(path) ||
        path.includes("\\") ||
        path.split("/").includes("..") ||
        !["exact", "semantic", "mixed"].includes(String(s.matchKind)) ||
        !["fresh", "unknown"].includes(String(s.freshness)) ||
        typeof s.selected !== "boolean"
      )
        throw new Error("Invalid project context source");
      const startLine = number(s.startLine);
      const endLine = number(s.endLine);
      if (
        !Number.isInteger(startLine) ||
        startLine < 1 ||
        !Number.isInteger(endLine) ||
        endLine < startLine
      )
        throw new Error("Invalid source range");
      return {
        id: contextString(s.id)!,
        path,
        startLine,
        endLine,
        matchKind: s.matchKind,
        characters: number(s.characters),
        freshness: s.freshness,
        selected: s.selected,
      };
    });
    output.contextReport = {
      outcome: v.outcome,
      reason: code(v.reason),
      sources,
      warnings: warnings(v.warnings),
      indexState: v.indexState,
      queryKind: v.queryKind,
      characters: number(v.characters),
      elapsedMs: number(v.elapsedMs),
      cacheHit: v.cacheHit,
      truncated: v.truncated,
    } as PromptContextReport;
  }
  if (result.contextHandle !== undefined)
    output.contextHandle = contextString(result.contextHandle)!;
  if (result.reviewRequired !== undefined) {
    if (typeof result.reviewRequired !== "boolean")
      throw new Error("Invalid review flag");
    output.reviewRequired = result.reviewRequired;
  }
  if (result.warningsJson)
    output.warnings = warnings(parse(result.warningsJson));
  return output;
};
