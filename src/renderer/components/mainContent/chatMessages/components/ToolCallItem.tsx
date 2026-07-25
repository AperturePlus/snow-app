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
import { ToolCallNode } from "../toolCalls/shared/ToolCallNode";
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

/** Detect whether the tool result JSON carries an error. */
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

    const effectiveStatus = hasResultError(toolCall.result)
      ? "error"
      : toolCall.status;
    const formattedArgs = formatArguments(toolCall.arguments);
    const hasBody = Boolean(formattedArgs || toolCall.result);

    return (
      <ToolCallNode
        toolName={toolCall.name}
        status={effectiveStatus}
      >
        {hasBody ? (
          <>
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
          </>
        ) : null}
      </ToolCallNode>
    );
  }
);

ToolCallItem.displayName = "ToolCallItem";
