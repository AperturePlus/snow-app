import { useMemo, useState } from "react";
import {
  AlertCircle,
  ChevronRight,
  Clock3,
  FolderOpen,
  Loader2,
  SquareTerminal,
} from "lucide-react";
import { useI18n } from "../../../../i18n";
import type { ToolCallInfo } from "../hooks/useChatConversation";
import { ToolNameBadge } from "./shared/ToolNameBadge";

type BashToolCallProps = {
  toolCall: ToolCallInfo;
};

type ParsedBashArgs = {
  command: string;
  workingDirectory: string;
  timeout?: number;
  isInteractive?: boolean;
};

type ParsedBashResult =
  | {
      type: "success";
      stdout: string;
      stderr: string;
      exitCode: number;
      command: string;
      executedAt: string;
    }
  | { type: "error"; message: string }
  | { type: "raw"; text: string }
  | { type: "empty" };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isOptionalBoolean = (value: unknown): value is boolean | undefined =>
  value === undefined || typeof value === "boolean";

const isOptionalTimeout = (value: unknown): value is number | undefined =>
  value === undefined ||
  (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);

const parseArgs = (args: string): ParsedBashArgs | null => {
  try {
    const parsed: unknown = JSON.parse(args);
    if (
      !isRecord(parsed) ||
      typeof parsed.command !== "string" ||
      typeof parsed.workingDirectory !== "string" ||
      !isOptionalTimeout(parsed.timeout) ||
      !isOptionalBoolean(parsed.isInteractive)
    ) {
      return null;
    }

    return {
      command: parsed.command,
      workingDirectory: parsed.workingDirectory,
      timeout: parsed.timeout,
      isInteractive: parsed.isInteractive,
    };
  } catch {
    return null;
  }
};

const parseResult = (result: string | undefined): ParsedBashResult => {
  if (!result) {
    return { type: "empty" };
  }

  try {
    const parsed: unknown = JSON.parse(result);
    if (!isRecord(parsed)) {
      return { type: "raw", text: result };
    }

    if (typeof parsed.error === "string") {
      return { type: "error", message: parsed.error };
    }

    if (
      typeof parsed.stdout === "string" &&
      typeof parsed.stderr === "string" &&
      typeof parsed.exitCode === "number" &&
      Number.isInteger(parsed.exitCode) &&
      typeof parsed.command === "string" &&
      typeof parsed.executedAt === "string"
    ) {
      return {
        type: "success",
        stdout: parsed.stdout,
        stderr: parsed.stderr,
        exitCode: parsed.exitCode,
        command: parsed.command,
        executedAt: parsed.executedAt,
      };
    }

    return { type: "raw", text: result };
  } catch {
    return { type: "raw", text: result };
  }
};

const formatRawJson = (value: string): string => {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
};

const getOutputLineCount = (output: string): number => {
  if (!output) {
    return 0;
  }

  return output.replace(/\r?\n$/, "").split(/\r?\n/).length;
};

const getCommandSummary = (command: string): string =>
  command.trim().split(/\r?\n/, 1)[0] ?? "";

export const BashToolCall = ({
  toolCall,
}: BashToolCallProps): React.JSX.Element => {
  const { locale, t } = useI18n();
  const parsedArgs = useMemo(
    () => parseArgs(toolCall.arguments),
    [toolCall.arguments]
  );
  const parsedResult = useMemo(
    () => parseResult(toolCall.result),
    [toolCall.result]
  );

  const command =
    parsedArgs?.command ||
    (parsedResult.type === "success" ? parsedResult.command : "") ||
    "terminal-execute";
  const commandSummary = getCommandSummary(command) || "terminal-execute";
  const rawArguments = parsedArgs ? "" : formatRawJson(toolCall.arguments);
  const hasFailed =
    parsedResult.type === "error" ||
    (parsedResult.type === "success" && parsedResult.exitCode !== 0);
  const effectiveStatus = hasFailed ? "error" : toolCall.status;
  const statusLabel = t(`toolCall.bash.status.${effectiveStatus}`);
  const emptyStateLabel = t(
    toolCall.status === "running"
      ? "toolCall.bash.running"
      : toolCall.status === "completed"
      ? "toolCall.bash.noResult"
      : toolCall.status === "error"
      ? "toolCall.bash.errorWithoutDetails"
      : "toolCall.bash.waiting"
  );

  const executedAt = useMemo(() => {
    if (parsedResult.type !== "success" || !parsedResult.executedAt) {
      return "";
    }

    const date = new Date(parsedResult.executedAt);
    return Number.isNaN(date.getTime())
      ? parsedResult.executedAt
      : date.toLocaleString(locale);
  }, [locale, parsedResult]);

  const isRunning = toolCall.status === "running";
  const displayStdout =
    parsedResult.type === "success"
      ? parsedResult.stdout
      : toolCall.streamingStdout ?? "";
  const displayStderr =
    parsedResult.type === "success"
      ? parsedResult.stderr
      : toolCall.streamingStderr ?? "";
  const hasStreamedOutput = Boolean(
    toolCall.streamingStdout || toolCall.streamingStderr
  );
  const hasVisibleOutput = Boolean(displayStdout || displayStderr);
  const stdoutLineCount = getOutputLineCount(displayStdout);
  const stderrLineCount = getOutputLineCount(displayStderr);
  const [isOpen, setIsOpen] = useState(false);

  return (
    <details
      className="tool-call-item tool-call-bash"
      open={isOpen}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
    >
      <summary className="tool-call-header">
        <ChevronRight
          className="tool-call-chevron"
          size={14}
          aria-hidden="true"
        />
        <ToolNameBadge name={t("toolCall.bash.name")} category="terminal" />
        {isRunning ? (
          <Loader2
            size={14}
            className="tool-call-icon-spinning"
            aria-hidden="true"
          />
        ) : (
          <SquareTerminal size={14} aria-hidden="true" />
        )}
        <span className="tool-call-name" title={command}>
          {commandSummary}
        </span>
        {parsedResult.type === "success" ? (
          <span
            className={`tool-call-bash-exit-code ${
              parsedResult.exitCode === 0
                ? "tool-call-bash-exit-success"
                : "tool-call-bash-exit-error"
            }`}
          >
            {t("toolCall.bash.exitCode", {
              values: { code: parsedResult.exitCode },
            })}
          </span>
        ) : null}
        <span
          className={`tool-call-status tool-call-status-${effectiveStatus}`}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {statusLabel}
        </span>
      </summary>

      <div className="tool-call-body tool-call-bash-body">
        {parsedArgs?.workingDirectory ? (
          <div className="tool-call-bash-workdir">
            <FolderOpen size={12} aria-hidden="true" />
            <span>{parsedArgs.workingDirectory}</span>
          </div>
        ) : null}

        {rawArguments ? (
          <section className="tool-call-section">
            <span className="tool-call-section-label">
              {t("toolCall.bash.arguments")}
            </span>
            <pre className="tool-call-section-pre">{rawArguments}</pre>
          </section>
        ) : null}

        <div className="tool-call-bash-terminal">
          <div className="tool-call-bash-terminal-header">
            <span className="tool-call-bash-terminal-title">
              <SquareTerminal size={12} aria-hidden="true" />
              {t("toolCall.bash.command")}
            </span>
          </div>
          <pre className="tool-call-bash-command">
            <span className="tool-call-bash-prompt" aria-hidden="true">
              $
            </span>
            <code>{command}</code>
          </pre>
        </div>

        {parsedArgs || executedAt ? (
          <div className="tool-call-bash-meta">
            {parsedArgs?.timeout !== undefined ? (
              <span className="tool-call-bash-meta-item">
                <Clock3 size={11} aria-hidden="true" />
                {t("toolCall.bash.timeout")}: {parsedArgs.timeout} ms
              </span>
            ) : null}
            {parsedArgs?.isInteractive !== undefined ? (
              <span className="tool-call-bash-meta-item">
                {t("toolCall.bash.interactive")}:{" "}
                {t(
                  parsedArgs.isInteractive
                    ? "toolCall.bash.boolean.yes"
                    : "toolCall.bash.boolean.no"
                )}
              </span>
            ) : null}
            {executedAt ? (
              <span className="tool-call-bash-meta-item">
                <Clock3 size={11} aria-hidden="true" />
                {t("toolCall.bash.executedAt")}: {executedAt}
              </span>
            ) : null}
          </div>
        ) : null}

        {parsedResult.type === "error" ? (
          <div className="tool-call-error">
            <AlertCircle size={12} aria-hidden="true" />
            <span>{parsedResult.message}</span>
          </div>
        ) : null}

        {hasVisibleOutput ? (
          <div
            className={`tool-call-bash-results ${
              isRunning ? "tool-call-bash-results-live" : ""
            }`}
            aria-live={isRunning ? "polite" : undefined}
          >
            {displayStdout ? (
              <section
                className="tool-call-bash-output"
                aria-label={t("toolCall.bash.stdout")}
              >
                <div className="tool-call-bash-output-header">
                  <span>{t("toolCall.bash.stdout")}</span>
                  <span>
                    {isRunning ? `${t("toolCall.bash.liveOutput")} · ` : ""}
                    {t("toolCall.bash.outputLines", {
                      values: { count: stdoutLineCount },
                    })}
                  </span>
                </div>
                <pre className="tool-call-bash-output-pre">
                  {displayStdout}
                  {isRunning && toolCall.streamingStdout ? (
                    <span
                      className="tool-call-bash-stream-cursor"
                      aria-hidden="true"
                    />
                  ) : null}
                </pre>
              </section>
            ) : null}

            {displayStderr ? (
              <section
                className="tool-call-bash-output tool-call-bash-stderr"
                aria-label={t("toolCall.bash.stderr")}
              >
                <div className="tool-call-bash-output-header">
                  <span>{t("toolCall.bash.stderr")}</span>
                  <span>
                    {isRunning ? `${t("toolCall.bash.liveOutput")} · ` : ""}
                    {t("toolCall.bash.outputLines", {
                      values: { count: stderrLineCount },
                    })}
                  </span>
                </div>
                <pre className="tool-call-bash-output-pre">
                  {displayStderr}
                  {isRunning && toolCall.streamingStderr ? (
                    <span
                      className="tool-call-bash-stream-cursor"
                      aria-hidden="true"
                    />
                  ) : null}
                </pre>
              </section>
            ) : null}
          </div>
        ) : parsedResult.type === "success" ? (
          <div className="tool-call-bash-empty-output">
            {t("toolCall.bash.noOutput")}
          </div>
        ) : null}

        {parsedResult.type === "raw" ? (
          <section className="tool-call-section">
            <span className="tool-call-section-label">
              {t("toolCall.bash.result")}
            </span>
            <pre className="tool-call-section-pre">{parsedResult.text}</pre>
          </section>
        ) : null}

        {parsedResult.type === "empty" && !hasStreamedOutput ? (
          <div
            className={`tool-call-bash-pending ${
              isRunning ? "tool-call-bash-pending-running" : ""
            }`}
          >
            {isRunning ? (
              <Loader2
                className="tool-call-icon-spinning"
                size={14}
                aria-hidden="true"
              />
            ) : toolCall.status === "error" ? (
              <AlertCircle size={13} aria-hidden="true" />
            ) : (
              <Clock3 size={13} aria-hidden="true" />
            )}
            <span>{emptyStateLabel}</span>
            {isRunning ? (
              <span className="tool-call-bash-loading-dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </details>
  );
};
