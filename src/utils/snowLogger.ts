import type { AppLogInput } from "../main/native/types";
import { native } from "../main/native/nativeBridge";

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

export interface LogEntry {
  module: string;
  func: string;
  line?: number;
  message: string;
  input?: string;
  output?: string;
  duration?: string;
  context?: string;
  error?: string;
}

export function writeLog(level: LogLevel, entry: LogEntry): void {
  const input: AppLogInput = {
    level,
    module: entry.module,
    func: entry.func,
    line: entry.line,
    message: entry.message,
    input: entry.input,
    output: entry.output,
    duration: entry.duration,
    context: entry.context,
    error: entry.error,
    source: "main",
  };
  native.writeAppLog(input).catch(() => {
    // Logging failures must not break application functionality.
  });
}

export const snowLog = {
  debug: (entry: LogEntry) => writeLog("DEBUG", entry),
  info: (entry: LogEntry) => writeLog("INFO", entry),
  warn: (entry: LogEntry) => writeLog("WARN", entry),
  error: (entry: LogEntry) => writeLog("ERROR", entry),
};
