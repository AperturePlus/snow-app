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

type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

async function sendLog(level: LogLevel, entry: LogEntry): Promise<void> {
  try {
    if (typeof window !== "undefined" && window.snow?.writeLog) {
      await window.snow.writeLog(level, entry);
    }
  } catch {
    // Logging failures must not break application functionality.
  }
}

export function sanitizeApiConfigForLog(
  data: Record<string, unknown>
): Record<string, unknown> {
  const sensitiveKeys = new Set([
    "apiKey",
    "visionApiKey",
    "embeddingApiKey",
    "rerankingApiKey",
  ]);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    result[key] =
      sensitiveKeys.has(key) && typeof value === "string" && value
        ? "***"
        : value;
  }
  return result;
}

export const snowLog = {
  debug: (entry: LogEntry) => void sendLog("DEBUG", entry),
  info: (entry: LogEntry) => void sendLog("INFO", entry),
  warn: (entry: LogEntry) => void sendLog("WARN", entry),
  error: (entry: LogEntry) => void sendLog("ERROR", entry),
};
