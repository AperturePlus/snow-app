import {
  CheckCircle,
  ChevronRight,
  Loader2,
  AlertCircle,
  Wrench,
} from "lucide-react";
import { memo } from "react";
import type { ToolCallInfo } from "../utils/conversationTypes";
import {
  AskUserQuestionToolCall,
  BashToolCall,
  FilesystemReadToolCall,
  FilesystemEditToolCall,
  FilesystemCreateToolCall,
  TodoToolCall,
  GrepToolCall,
  SubAgentToolCall,
  CodebaseToolCall,
} from "../toolCalls";
import { ToolNameBadge } from "../toolCalls/shared/ToolNameBadge";
import { useI18n } from "../../../../i18n";

type ToolCallItemProps = {
  toolCall: ToolCallInfo;
};

/** Pretty-print JSON arguments if possible, otherwise return raw string. */
const formatArguments = (args: string): string => {
  if (!args || args === "{}") {
    return "";
  }
  try {
    return JSON.stringify(JSON.parse(args), null, 2);
  } catch {
    return args;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Detect whether the tool result JSON carries an error, mirroring the
 *  logic used by specialised renderers (Bash, Grep, Todo, etc.).  When the
 *  agent loop catches an exception or a hook blocks the call, it still sets
 *  `status: "completed"` but embeds `{ error: "..." }` (or
 *  `{ success: false, error: "..." }`) in the result.  We need to surface
 *  that as a failure in the UI. */
const hasResultError = (result: string | undefined): boolean => {
  if (!result) {
    return false;
  }
  try {
    const parsed: unknown = JSON.parse(result);
    if (!isRecord(parsed)) {
      return false;
    }
    return typeof parsed.error === "string";
  } catch {
    return false;
  }
};

export const ToolCallItem = memo(
  ({ toolCall }: ToolCallItemProps): React.JSX.Element => {
    const { t } = useI18n();
    // Delegate to specialized renderers based on tool name
    if (toolCall.name === "mcp__user-interaction__askUserQuestion") {
      return <AskUserQuestionToolCall toolCall={toolCall} />;
    }

    if (toolCall.name === "mcp__filesystem__read") {
      return <FilesystemReadToolCall toolCall={toolCall} />;
    }

    if (toolCall.name === "mcp__filesystem__replace_edit") {
      return <FilesystemEditToolCall toolCall={toolCall} />;
    }

    if (toolCall.name === "mcp__filesystem__create") {
      return <FilesystemCreateToolCall toolCall={toolCall} />;
    }

    if (toolCall.name === "mcp__bash__terminal-execute") {
      return <BashToolCall toolCall={toolCall} />;
    }

    if (toolCall.name === "mcp__todo__todo-manage") {
      return <TodoToolCall toolCall={toolCall} />;
    }

    if (toolCall.name === "mcp__grep__search") {
      return <GrepToolCall toolCall={toolCall} />;
    }

    if (toolCall.name === "mcp__sub-agents__activate") {
      return <SubAgentToolCall toolCall={toolCall} />;
    }

    if (toolCall.name === "mcp__codebase__search") {
      return <CodebaseToolCall toolCall={toolCall} />;
    }

    const iconName = toolCall.name.replace(/^mcp__.*__/, "");
    const effectiveStatus = hasResultError(toolCall.result)
      ? "error"
      : toolCall.status;
    const StatusIcon =
      effectiveStatus === "completed"
        ? CheckCircle
        : effectiveStatus === "running"
        ? Loader2
        : effectiveStatus === "error"
        ? AlertCircle
        : Wrench;
    const formattedArgs = formatArguments(toolCall.arguments);
    const hasBody = Boolean(formattedArgs || toolCall.result);

    return (
      <details className="tool-call-item">
        <summary className="tool-call-header">
          <ChevronRight
            className="tool-call-chevron"
            size={14}
            aria-hidden="true"
          />
          <StatusIcon
            size={14}
            className={
              effectiveStatus === "running" ? "tool-call-icon-spinning" : ""
            }
            aria-hidden="true"
          />
          <ToolNameBadge name={iconName} />
          <span
            className={`tool-call-status tool-call-status-${effectiveStatus}`}
          >
            {t(`toolCall.common.status.${effectiveStatus}`, {
              defaultValue: effectiveStatus,
            })}
          </span>
        </summary>
        {hasBody ? (
          <div className="tool-call-body">
            {formattedArgs ? (
              <div className="tool-call-section">
                <span className="tool-call-section-label">
                  {t("toolCall.common.arguments")}
                </span>
                <pre className="tool-call-section-pre">{formattedArgs}</pre>
              </div>
            ) : null}
            {toolCall.result ? (
              <div className="tool-call-section">
                <span className="tool-call-section-label">
                  {t("toolCall.common.result")}
                </span>
                <pre className="tool-call-section-pre">{toolCall.result}</pre>
              </div>
            ) : null}
          </div>
        ) : null}
      </details>
    );
  }
);

ToolCallItem.displayName = "ToolCallItem";
