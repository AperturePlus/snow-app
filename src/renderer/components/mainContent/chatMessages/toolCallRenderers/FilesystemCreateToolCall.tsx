import { useMemo } from "react";
import { ChevronRight } from "lucide-react";
import type { ToolCallInfo } from "../useChatConversation";
import { getFileTypeIcon } from "../../../../utils/fileIcons";
import { ToolNameBadge } from "./shared/ToolNameBadge";
import { getFileName, getToolDisplayName } from "./shared/formatters";
import { computeCreateDiff } from "./shared/diffUtils";
import { MiniDiffViewer } from "./shared/MiniDiffViewer";

type FilesystemCreateToolCallProps = {
  toolCall: ToolCallInfo;
};

type ParsedCreateArgs = {
  filePath: string;
  content: string;
  overwrite?: boolean;
};

type ParsedCreateResult =
  | { type: "success"; path: string }
  | { type: "error"; message: string }
  | { type: "raw"; text: string }
  | { type: "empty" };

const parseArgs = (args: string): ParsedCreateArgs | null => {
  try {
    const parsed = JSON.parse(args);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    const filePath = typeof parsed.filePath === "string" ? parsed.filePath : "";
    if (!filePath) {
      return null;
    }
    return {
      filePath,
      content: typeof parsed.content === "string" ? parsed.content : "",
      overwrite:
        typeof parsed.overwrite === "boolean" ? parsed.overwrite : undefined,
    };
  } catch {
    return null;
  }
};

const parseResult = (result: string | undefined): ParsedCreateResult => {
  if (!result) {
    return { type: "empty" };
  }

  try {
    const parsed = JSON.parse(result);

    if (typeof parsed === "object" && parsed !== null) {
      if (typeof parsed.error === "string") {
        return { type: "error", message: parsed.error };
      }

      if (parsed.success === true) {
        return {
          type: "success",
          path: typeof parsed.path === "string" ? parsed.path : "",
        };
      }
    }

    return { type: "raw", text: result };
  } catch {
    return { type: "raw", text: result };
  }
};

export const FilesystemCreateToolCall = ({
  toolCall,
}: FilesystemCreateToolCallProps): React.JSX.Element => {
  const parsedArgs = useMemo(
    () => parseArgs(toolCall.arguments),
    [toolCall.arguments]
  );
  const parsedResult = useMemo(
    () => parseResult(toolCall.result),
    [toolCall.result]
  );

  const diffLines = useMemo(() => {
    if (!parsedArgs?.content) {
      return [];
    }
    return computeCreateDiff(parsedArgs.content);
  }, [parsedArgs]);

  const toolName = getToolDisplayName("create");
  const filePath = parsedArgs?.filePath ?? "create";
  const fileName = getFileName(filePath);

  const hasError = parsedResult.type === "error";
  const effectiveStatus = hasError ? "error" : toolCall.status;

  const lineCount = useMemo(() => {
    if (!parsedArgs?.content) return 0;
    return parsedArgs.content.split("\n").length;
  }, [parsedArgs]);

  return (
    <details className="tool-call-item tool-call-filesystem-create">
      <summary className="tool-call-header">
        <ChevronRight
          className="tool-call-chevron"
          size={14}
          aria-hidden="true"
        />
        <ToolNameBadge name={toolName} category="create" />
        {getFileTypeIcon(fileName, false, false, {
          size: 14,
          className:
            toolCall.status === "running" ? "tool-call-icon-spinning" : "",
          "aria-hidden": true,
        })}
        <span className="tool-call-name" title={filePath}>
          {fileName}
        </span>
        {lineCount > 0 ? (
          <span className="tool-call-diff-stats">
            <span className="tool-call-diff-add">+{lineCount}</span>
          </span>
        ) : null}
        <span
          className={`tool-call-status tool-call-status-${effectiveStatus}`}
        >
          {effectiveStatus}
        </span>
      </summary>
      <div className="tool-call-body">
        <div className="tool-call-file-path">{filePath}</div>
        {hasError ? (
          <div className="tool-call-error">
            <span>{parsedResult.message}</span>
          </div>
        ) : null}

        {parsedArgs?.overwrite ? (
          <div className="tool-call-meta-row">
            <span className="tool-call-meta-label">overwrite</span>
            <span className="tool-call-meta-value">true</span>
          </div>
        ) : null}

        {parsedResult.type === "success" ? (
          <div className="tool-call-success-row">
            created {parsedResult.path}
          </div>
        ) : null}

        {diffLines.length > 0 ? (
          <MiniDiffViewer diffLines={diffLines} maxLines={50} />
        ) : null}

        {parsedResult.type === "raw" ? (
          <pre className="tool-call-section-pre">{parsedResult.text}</pre>
        ) : null}

        {parsedResult.type === "empty" && !hasError ? (
          <div className="tool-call-pending">
            {parsedArgs ? (
              <pre className="tool-call-section-pre">
                {JSON.stringify(parsedArgs, null, 2)}
              </pre>
            ) : (
              <span className="tool-call-section-label">No arguments</span>
            )}
          </div>
        ) : null}
      </div>
    </details>
  );
};
