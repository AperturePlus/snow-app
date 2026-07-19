import { useMemo } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import { useI18n } from "../../../../i18n";
import type { ToolCallInfo } from "../utils/conversationTypes";
import { getFileTypeIcon } from "../../../../utils/fileIcons";
import { ToolNameBadge } from "./shared/ToolNameBadge";
import { getFileName, getToolDisplayName } from "./shared/formatters";
import { computeLineDiff } from "./shared/diffUtils";
import { MiniDiffViewer } from "./shared/MiniDiffViewer";

type FilesystemEditToolCallProps = {
  toolCall: ToolCallInfo;
};

type ParsedEditArgs = {
  filePath: string;
  searchContent: string;
  replaceContent: string;
  occurrence?: number;
};

type ParsedEditResult =
  | {
      type: "success";
      matchIndex: number;
      totalMatches: number;
      occurrence: number;
    }
  | { type: "error"; message: string }
  | { type: "raw"; text: string }
  | { type: "empty" };

const parseArgs = (args: string): ParsedEditArgs | null => {
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
      searchContent:
        typeof parsed.searchContent === "string" ? parsed.searchContent : "",
      replaceContent:
        typeof parsed.replaceContent === "string" ? parsed.replaceContent : "",
      occurrence:
        typeof parsed.occurrence === "number" ? parsed.occurrence : undefined,
    };
  } catch {
    return null;
  }
};

const parseResult = (result: string | undefined): ParsedEditResult => {
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
          matchIndex:
            typeof parsed.matchIndex === "number" ? parsed.matchIndex : 0,
          totalMatches:
            typeof parsed.totalMatches === "number" ? parsed.totalMatches : 1,
          occurrence:
            typeof parsed.occurrence === "number" ? parsed.occurrence : 1,
        };
      }
    }

    return { type: "raw", text: result };
  } catch {
    return { type: "raw", text: result };
  }
};

export const FilesystemEditToolCall = ({
  toolCall,
}: FilesystemEditToolCallProps): React.JSX.Element => {
  const { t } = useI18n();
  const parsedArgs = useMemo(
    () => parseArgs(toolCall.arguments),
    [toolCall.arguments]
  );
  const parsedResult = useMemo(
    () => parseResult(toolCall.result),
    [toolCall.result]
  );

  const diffLines = useMemo(() => {
    if (!parsedArgs?.searchContent || !parsedArgs?.replaceContent) {
      return [];
    }
    return computeLineDiff(parsedArgs.searchContent, parsedArgs.replaceContent);
  }, [parsedArgs]);

  const toolName = getToolDisplayName("edit");
  const filePath = parsedArgs?.filePath ?? "edit";
  const fileName = getFileName(filePath);

  const hasError = parsedResult.type === "error";
  const effectiveStatus = hasError ? "error" : toolCall.status;
  const statusLabel = t(`toolCall.filesystem.status.${effectiveStatus}`);

  const stats = useMemo(() => {
    if (diffLines.length === 0) return null;
    const additions = diffLines.filter((l) => l.type === "add").length;
    const deletions = diffLines.filter((l) => l.type === "del").length;
    return { additions, deletions };
  }, [diffLines]);

  return (
    <details className="tool-call-item tool-call-filesystem-edit">
      <summary className="tool-call-header">
        <ChevronRight
          className="tool-call-chevron"
          size={14}
          aria-hidden="true"
        />
        <ToolNameBadge name={toolName} category="edit" />
        {toolCall.status === "running" ? (
          <Loader2
            size={14}
            className="tool-call-icon-spinning"
            aria-hidden="true"
          />
        ) : (
          getFileTypeIcon(fileName, false, false, {
            size: 14,
            "aria-hidden": true,
          })
        )}
        <span className="tool-call-name" title={filePath}>
          {fileName}
        </span>
        {stats ? (
          <span className="tool-call-diff-stats">
            <span className="tool-call-diff-add">+{stats.additions}</span>
            <span className="tool-call-diff-del">-{stats.deletions}</span>
          </span>
        ) : null}
        <span
          className={`tool-call-status tool-call-status-${effectiveStatus}`}
        >
          {statusLabel}
        </span>
      </summary>
      <div className="tool-call-body">
        <div className="tool-call-file-path">{filePath}</div>
        {hasError ? (
          <div className="tool-call-error">
            <span>{parsedResult.message}</span>
          </div>
        ) : null}

        {parsedArgs?.occurrence ? (
          <div className="tool-call-meta-row">
            <span className="tool-call-meta-label">occurrence</span>
            <span className="tool-call-meta-value">
              {parsedArgs.occurrence}
            </span>
          </div>
        ) : null}

        {parsedResult.type === "success" ? (
          <div className="tool-call-success-row">
            matched at index {parsedResult.matchIndex}
            {parsedResult.totalMatches > 1
              ? ` (${parsedResult.occurrence}/${parsedResult.totalMatches})`
              : ""}
          </div>
        ) : null}

        {diffLines.length > 0 ? <MiniDiffViewer diffLines={diffLines} /> : null}

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
