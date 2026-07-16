import type { DiffLine } from "./types";

/**
 * Compute a line-level diff between two text blocks using LCS algorithm.
 * Returns an array of DiffLine entries (context / add / del).
 *
 * For very large inputs (> 500 lines combined), falls back to a simple
 * "show old as deleted, new as added" strategy to avoid performance issues.
 */
export const computeLineDiff = (
  oldText: string,
  newText: string
): DiffLine[] => {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  // Performance guard: skip O(m*n) DP for very large inputs
  if (oldLines.length + newLines.length > 500) {
 return computeSimpleDiff(oldLines, newLines);
  }

  return computeLcsDiff(oldLines, newLines);
};

const computeLcsDiff = (
  oldLines: string[],
  newLines: string[]
): DiffLine[] => {
  const m = oldLines.length;
  const n = newLines.length;

  // dp[i][j] = length of LCS of oldLines[0..i-1] and newLines[0..j-1]
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0)
  );

  for (let i = 1; i <= m; i++) {
 for (let j = 1; j <= n; j++) {
   if (oldLines[i - 1] === newLines[j - 1]) {
 dp[i][j] = dp[i - 1][j - 1] + 1;
   } else {
 dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
   }
 }
  }

  // Backtrack to produce diff (built in reverse, then reversed)
  const reversed: DiffLine[] = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
 if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
   reversed.push({
 type: "context",
 content: oldLines[i - 1],
 oldNum: String(i),
 newNum: String(j),
   });
   i--;
   j--;
 } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
   reversed.push({
 type: "add",
 content: newLines[j - 1],
 oldNum: "",
 newNum: String(j),
   });
   j--;
 } else {
   reversed.push({
 type: "del",
 content: oldLines[i - 1],
 oldNum: String(i),
 newNum: "",
   });
   i--;
 }
  }

  reversed.reverse();
  return reversed;
};

/**
 * Simple fallback: show all old lines as deleted, all new lines as added.
 * Used when input is too large for LCS.
 */
const computeSimpleDiff = (
  oldLines: string[],
  newLines: string[]
): DiffLine[] => {
  const result: DiffLine[] = [];

  for (let i = 0; i < oldLines.length; i++) {
 result.push({
   type: "del",
   content: oldLines[i],
   oldNum: String(i + 1),
   newNum: "",
 });
  }

  for (let j = 0; j < newLines.length; j++) {
 result.push({
   type: "add",
   content: newLines[j],
   oldNum: "",
   newNum: String(j + 1),
 });
  }

  return result;
};

/**
 * Produce a diff for a newly created file: all lines are "add".
 */
export const computeCreateDiff = (content: string): DiffLine[] =>
  content.split("\n").map((line, idx) => ({
 type: "add",
 content: line,
 oldNum: "",
 newNum: String(idx + 1),
  }));
