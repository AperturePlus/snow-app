export type RendererLogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

export type RendererLogEntry = {
  module: string;
  func: string;
  message: string;
  line?: number;
  input?: string;
  output?: string;
  duration?: string;
  context?: string;
  error?: string;
};

export const writeRendererLog = (
  level: RendererLogLevel,
  entry: RendererLogEntry,
): void => {
  try {
    const writeLog = window.snow?.writeLog;
    if (typeof writeLog !== "function") return;
    void writeLog(level, entry).catch(() => {});
  } catch {}
};
