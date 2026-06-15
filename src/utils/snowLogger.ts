import { existsSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const LOG_DIR = join(process.cwd(), ".snow", "log");

function ensureLogDir(): void {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
}

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

function formatLogEntry(level: LogLevel, entry: LogEntry): string {
  const timestamp = new Date().toISOString();
  const date = timestamp.slice(0, 10);
  const location =
    entry.module +
    ":" +
    entry.func +
    (entry.line !== undefined ? ":" + entry.line : "");

  let text = `[${timestamp}] [${level}] [${location}]\n`;
  text += `  ├─ Message: ${entry.message}\n`;
  if (entry.input !== undefined) {
    text += `  ├─ Input: ${entry.input}\n`;
  }
  if (entry.output !== undefined) {
    text += `  ├─ Output: ${entry.output}\n`;
  }
  if (entry.duration !== undefined) {
    text += `  ├─ Duration: ${entry.duration}\n`;
  }
  if (entry.context !== undefined) {
    text += `  ├─ Context: ${entry.context}\n`;
  }
  if (entry.error !== undefined) {
    text += `  └─ Error: ${entry.error}\n`;
  } else {
    text += `  └─ (end)\n`;
  }
  text += "\n";

  return text;
}

export function writeLog(level: LogLevel, entry: LogEntry): void {
  try {
    ensureLogDir();
    const timestamp = new Date().toISOString();
    const date = timestamp.slice(0, 10);
    const file = join(LOG_DIR, `${entry.module}_${date}.txt`);
    appendFileSync(file, formatLogEntry(level, entry), "utf-8");
  } catch {
    // Logging failures must not break application functionality.
  }
}

export const snowLog = {
  debug: (entry: LogEntry) => writeLog("DEBUG", entry),
  info: (entry: LogEntry) => writeLog("INFO", entry),
  warn: (entry: LogEntry) => writeLog("WARN", entry),
  error: (entry: LogEntry) => writeLog("ERROR", entry),
};
