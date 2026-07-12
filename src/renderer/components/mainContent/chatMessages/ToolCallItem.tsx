import {
  CheckCircle,
  ChevronRight,
  Loader2,
  AlertCircle,
  Wrench,
} from "lucide-react";
import type { ToolCallInfo } from "./useChatConversation";
import {
  BashToolCall,
  FilesystemReadToolCall,
  FilesystemEditToolCall,
  FilesystemCreateToolCall,
  TodoToolCall,
  GrepToolCall,
} from "./toolCallRenderers";
import { ToolNameBadge } from "./toolCallRenderers/shared/ToolNameBadge";

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

export const ToolCallItem = ({
  toolCall,
}: ToolCallItemProps): React.JSX.Element => {
  // Delegate to specialized renderers based on tool name
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

  const iconName = toolCall.name.replace(/^mcp__.*__/, "");
  const StatusIcon =
    toolCall.status === "completed"
      ? CheckCircle
      : toolCall.status === "running"
      ? Loader2
      : toolCall.status === "error"
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
            toolCall.status === "running" ? "tool-call-icon-spinning" : ""
          }
          aria-hidden="true"
        />
        <ToolNameBadge name={iconName} />
        <span
          className={`tool-call-status tool-call-status-${toolCall.status}`}
        >
          {toolCall.status}
        </span>
      </summary>
      {hasBody ? (
        <div className="tool-call-body">
          {formattedArgs ? (
            <div className="tool-call-section">
              <span className="tool-call-section-label">Arguments</span>
              <pre className="tool-call-section-pre">{formattedArgs}</pre>
            </div>
          ) : null}
          {toolCall.result ? (
            <div className="tool-call-section">
              <span className="tool-call-section-label">Result</span>
              <pre className="tool-call-section-pre">{toolCall.result}</pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </details>
  );
};
