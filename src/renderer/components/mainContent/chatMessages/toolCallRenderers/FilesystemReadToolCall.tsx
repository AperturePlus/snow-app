import { useMemo } from "react";
import {
  CheckCircle,
  ChevronRight,
  Loader2,
  AlertCircle,
  FileText,
  Hash,
} from "lucide-react";
import type { ToolCallInfo } from "../useChatConversation";
import { getFileTypeIcon } from "../../../../utils/fileIcons";
import { ToolNameBadge } from "./shared/ToolNameBadge";

type FilesystemReadToolCallProps = {
  toolCall: ToolCallInfo;
};

type ParsedArgs = {
  filePath: string;
  startLine?: number;
  endLine?: number;
};

type ParsedResult =
  | {
      type: "file";
      content: string;
      totalLines: number;
      startLine: number;
      endLine: number;
    }
  | { type: "directory"; entries: string[] }
  | { type: "image"; content: string; mediaType: string }
  | { type: "error"; message: string }
  | { type: "raw"; text: string }
  | { type: "empty" };

const parseArgs = (args: string): ParsedArgs | null => {
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
      startLine:
        typeof parsed.startLine === "number" ? parsed.startLine : undefined,
      endLine: typeof parsed.endLine === "number" ? parsed.endLine : undefined,
    };
  } catch {
    return null;
  }
};

const parseResult = (
  result: string | undefined,
  filePath: string
): ParsedResult => {
  if (!result) {
    return { type: "empty" };
  }

  try {
    const parsed = JSON.parse(result);

    if (typeof parsed === "object" && parsed !== null) {
      if (typeof parsed.error === "string") {
        return { type: "error", message: parsed.error };
      }

      if (typeof parsed.content === "string") {
        if (parsed.isImage === true) {
          return {
            type: "image",
            content: parsed.content,
            mediaType:
              typeof parsed.mediaType === "string" ? parsed.mediaType : "image",
          };
        }

        if (
          typeof parsed.totalLines === "number" &&
          typeof parsed.startLine === "number" &&
          typeof parsed.endLine === "number"
        ) {
          return {
            type: "file",
            content: parsed.content,
            totalLines: parsed.totalLines,
            startLine: parsed.startLine,
            endLine: parsed.endLine,
          };
        }

        // No line metadata -> directory listing
        const entries = parsed.content
          .split("\n")
          .filter((line: string) => line.length > 0);
        return { type: "directory", entries };
      }
    }

    return { type: "raw", text: result };
  } catch {
    return { type: "raw", text: result };
  }
};

const getLineRangeLabel = (
  parsedArgs: ParsedArgs | null,
  parsedResult: ParsedResult
): string => {
  if (parsedResult.type === "directory") {
    return "directory";
  }

  if (parsedResult.type === "file") {
    const { startLine, endLine, totalLines } = parsedResult;
    if (endLine - startLine + 1 >= totalLines) {
      return `${totalLines} lines`;
    }
    return `L${startLine}-${endLine}`;
  }

  if (parsedArgs?.startLine || parsedArgs?.endLine) {
    const start = parsedArgs.startLine ?? 1;
    const end = parsedArgs.endLine ?? start;
    return end > start ? `L${start}-${end}` : `L${start}`;
  }

  return "";
};

export const FilesystemReadToolCall = ({
  toolCall,
}: FilesystemReadToolCallProps): React.JSX.Element => {
  const parsedArgs = useMemo(
    () => parseArgs(toolCall.arguments),
    [toolCall.arguments]
  );
  const parsedResult = useMemo(
    () => parseResult(toolCall.result, parsedArgs?.filePath ?? ""),
    [toolCall.result, parsedArgs]
  );

  const isDirectory = parsedResult.type === "directory";

  const rangeLabel = getLineRangeLabel(parsedArgs, parsedResult);
  const filePath = parsedArgs?.filePath ?? "read";
  const fileName = filePath.split(/[\\/]/).filter(Boolean).pop() || filePath;

  const hasError = parsedResult.type === "error";
  const effectiveStatus = hasError ? "error" : toolCall.status;

  const StatusIcon =
    effectiveStatus === "completed"
      ? CheckCircle
      : effectiveStatus === "running"
      ? Loader2
      : effectiveStatus === "error"
      ? AlertCircle
      : FileText;

  return (
    <details className="tool-call-item tool-call-filesystem-read">
      <summary className="tool-call-header">
        <ChevronRight
          className="tool-call-chevron"
          size={14}
          aria-hidden="true"
        />
        <ToolNameBadge name="read" category="read" />
        {getFileTypeIcon(fileName, isDirectory, false, {
          size: 14,
          className:
            toolCall.status === "running" ? "tool-call-icon-spinning" : "",
          "aria-hidden": true,
        })}
        <span className="tool-call-name" title={filePath}>
          {fileName}
        </span>
        {rangeLabel ? (
          <span className="tool-call-line-range">
            <Hash size={10} aria-hidden="true" />
            {rangeLabel}
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
            <AlertCircle size={12} aria-hidden="true" />
            <span>{parsedResult.message}</span>
          </div>
        ) : null}

        {parsedResult.type === "directory" ? (
          <div className="tool-call-dir-listing">
            {parsedResult.entries.map((entry, i) => {
              const isDir = entry.endsWith("/");
              return (
                <div key={i} className="tool-call-dir-entry">
                  {getFileTypeIcon(
                    isDir ? entry.slice(0, -1) : entry,
                    isDir,
                    false,
                    { size: 12, "aria-hidden": true }
                  )}
                  <span>{isDir ? entry.slice(0, -1) : entry}</span>
                </div>
              );
            })}
          </div>
        ) : null}

        {parsedResult.type === "file" ? (
          <div className="tool-call-file-result">
            <div className="tool-call-file-meta">
              <span>
                Lines {parsedResult.startLine}-{parsedResult.endLine} of{" "}
                {parsedResult.totalLines}
              </span>
            </div>
            <pre className="tool-call-section-pre tool-call-file-content">
              {parsedResult.content}
            </pre>
          </div>
        ) : null}

        {parsedResult.type === "image" ? (
          <div className="tool-call-image-result">
            <div className="tool-call-file-meta">
              <span>{parsedResult.mediaType}</span>
            </div>
            <img
              src={
                parsedResult.content.match(/@@image:([^@]+)@@/)?.[1] ??
                parsedResult.content
              }
              alt={`Image preview (${parsedResult.mediaType})`}
              className="tool-call-image-preview"
            />
          </div>
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
