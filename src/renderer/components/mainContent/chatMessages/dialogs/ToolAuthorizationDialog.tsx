import { FilePen, FilePlus, ShieldAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { useI18n } from "../../../../i18n";
import { getFileTypeIcon } from "../../../../utils/fileIcons";
import {
  computeCreateDiff,
  computeLineDiff,
} from "../toolCalls/shared/diffUtils";
import { getFileName } from "../toolCalls/shared/formatters";
import { MiniDiffViewer } from "../toolCalls/shared/MiniDiffViewer";
import type { DiffLine } from "../toolCalls/shared/types";
import type { ToolCallInfo } from "../hooks/useChatConversation";

type ToolAuthorizationDialogProps = {
  toolCalls: ToolCallInfo[];
  onApprove: (toolCall: ToolCallInfo) => void;
  onApproveAlways: (toolCall: ToolCallInfo) => void;
  onReject: (toolCall: ToolCallInfo, reason: string) => void;
};

type FileMutationKind = "edit" | "create";

type FileMutationPreview = {
  kind: FileMutationKind;
  filePath: string;
  fileName: string;
  diffLines: DiffLine[];
  additions: number;
  deletions: number;
  occurrence?: number;
  overwrite?: boolean;
};

const FILE_EDIT_TOOL = "mcp__filesystem__replace_edit";
const FILE_CREATE_TOOL = "mcp__filesystem__create";

const isFileMutationTool = (toolName: string): boolean =>
  toolName === FILE_EDIT_TOOL || toolName === FILE_CREATE_TOOL;

const parseFileMutationPreview = (
  toolCall: ToolCallInfo
): FileMutationPreview | null => {
  if (!isFileMutationTool(toolCall.name)) {
    return null;
  }

  try {
    const parsed = JSON.parse(toolCall.arguments || "{}") as Record<
      string,
      unknown
    >;
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }

    const filePath =
      typeof parsed.filePath === "string" ? parsed.filePath.trim() : "";
    if (!filePath) {
      return null;
    }

    if (toolCall.name === FILE_EDIT_TOOL) {
      const searchContent =
        typeof parsed.searchContent === "string" ? parsed.searchContent : "";
      const replaceContent =
        typeof parsed.replaceContent === "string" ? parsed.replaceContent : "";
      const occurrence =
        typeof parsed.occurrence === "number" ? parsed.occurrence : undefined;
      const diffLines = computeLineDiff(searchContent, replaceContent);
      const additions = diffLines.filter((line) => line.type === "add").length;
      const deletions = diffLines.filter((line) => line.type === "del").length;

      return {
        kind: "edit",
        filePath,
        fileName: getFileName(filePath),
        diffLines,
        additions,
        deletions,
        occurrence,
      };
    }

    const content = typeof parsed.content === "string" ? parsed.content : "";
    const overwrite =
      typeof parsed.overwrite === "boolean" ? parsed.overwrite : undefined;
    const diffLines = computeCreateDiff(content);
    const additions = diffLines.length;

    return {
      kind: "create",
      filePath,
      fileName: getFileName(filePath),
      diffLines,
      additions,
      deletions: 0,
      overwrite,
    };
  } catch {
    return null;
  }
};

const FileMutationAuthorizationPreview = ({
  preview,
}: {
  preview: FileMutationPreview;
}): React.JSX.Element => {
  const { t } = useI18n();
  const KindIcon = preview.kind === "edit" ? FilePen : FilePlus;

  return (
    <div className="tool-authorization-file-preview">
      <div className="tool-authorization-file-meta">
        <span className="tool-authorization-file-kind" data-kind={preview.kind}>
          <KindIcon size={12} aria-hidden="true" />
          <span>
            {preview.kind === "edit"
              ? t("toolAuthorization.fileEdit")
              : t("toolAuthorization.fileCreate")}
          </span>
        </span>
        <div className="tool-authorization-file-path-row">
          {getFileTypeIcon(preview.fileName, false, false, {
            size: 14,
            "aria-hidden": true,
          })}
          <code
            className="tool-authorization-file-path"
            title={preview.filePath}
          >
            {preview.fileName}
          </code>
          {preview.additions > 0 || preview.deletions > 0 ? (
            <span className="tool-call-diff-stats">
              {preview.additions > 0 ? (
                <span className="tool-call-diff-add">+{preview.additions}</span>
              ) : null}
              {preview.deletions > 0 ? (
                <span className="tool-call-diff-del">-{preview.deletions}</span>
              ) : null}
            </span>
          ) : null}
        </div>
        <div
          className="tool-authorization-file-full-path"
          title={preview.filePath}
        >
          {preview.filePath}
        </div>
        {preview.occurrence ? (
          <div className="tool-authorization-file-extra">
            {t("toolAuthorization.occurrence", {
              values: { value: String(preview.occurrence) },
            })}
          </div>
        ) : null}
        {preview.overwrite ? (
          <div className="tool-authorization-file-extra">
            {t("toolAuthorization.overwrite")}
          </div>
        ) : null}
      </div>

      {preview.diffLines.length > 0 ? (
        <MiniDiffViewer diffLines={preview.diffLines} maxLines={80} />
      ) : (
        <div className="tool-authorization-file-empty">
          {t("toolAuthorization.noDiff")}
        </div>
      )}
    </div>
  );
};

const AuthorizationToolItem = ({
  toolCall,
  isSubmitting,
  onApprove,
  onApproveAlways,
  onReject,
}: {
  toolCall: ToolCallInfo;
  isSubmitting: boolean;
  onApprove: (toolCall: ToolCallInfo) => void;
  onApproveAlways: (toolCall: ToolCallInfo) => void;
  onReject: (toolCall: ToolCallInfo, reason: string) => void;
}): React.JSX.Element => {
  const { t } = useI18n();
  const [rejectionReason, setRejectionReason] = useState("");
  const authorizationId =
    toolCall.authorizationId ??
    `${toolCall.name}-${toolCall.callId ?? toolCall.arguments}`;
  const filePreview = useMemo(
    () => parseFileMutationPreview(toolCall),
    [toolCall]
  );
  const isFileMutation = filePreview !== null;

  return (
    <article className="tool-authorization-prompt-item" key={authorizationId}>
      {isFileMutation && filePreview ? (
        <FileMutationAuthorizationPreview preview={filePreview} />
      ) : (
        <>
          <div className="tool-authorization-tool-row">
            <span className="tool-authorization-tool-label">
              {t("toolAuthorization.toolName")}
            </span>
            <code className="tool-authorization-tool-name">
              {toolCall.name}
            </code>
          </div>
          <div className="tool-authorization-args">
            <span className="tool-authorization-tool-label">
              {t("toolAuthorization.arguments")}
            </span>
            <pre>{toolCall.arguments || "{}"}</pre>
          </div>
        </>
      )}
      <label className="tool-authorization-rejection-reason">
        <span className="tool-authorization-tool-label">
          {t("toolAuthorization.rejectionReason")}
        </span>
        <textarea
          disabled={isSubmitting}
          onChange={(event) => setRejectionReason(event.target.value)}
          placeholder={t("toolAuthorization.rejectionReasonPlaceholder")}
          rows={2}
          value={rejectionReason}
        />
      </label>
      <div className="tool-authorization-actions">
        <button
          className="tool-authorization-action tool-authorization-reject"
          disabled={isSubmitting}
          onClick={() => {
            onReject(
              toolCall,
              rejectionReason.trim() ||
                t("toolAuthorization.defaultRejectionReason")
            );
          }}
          type="button"
        >
          {t("toolAuthorization.reject")}
        </button>
        <button
          className="tool-authorization-action tool-authorization-approve"
          disabled={isSubmitting}
          onClick={() => {
            onApprove(toolCall);
          }}
          type="button"
        >
          {t("toolAuthorization.approve")}
        </button>
        <button
          className="tool-authorization-action tool-authorization-approve-always"
          disabled={isSubmitting}
          onClick={() => {
            onApproveAlways(toolCall);
          }}
          type="button"
        >
          {t("toolAuthorization.approveAlways")}
        </button>
      </div>
    </article>
  );
};

export const ToolAuthorizationDialog = ({
  toolCalls,
  onApprove,
  onApproveAlways,
  onReject,
}: ToolAuthorizationDialogProps): React.JSX.Element | null => {
  const { t } = useI18n();
  const [submittingAuthorizationId, setSubmittingAuthorizationId] = useState<
    string | null
  >(null);

  if (toolCalls.length === 0) {
    return null;
  }

  const hasFileMutation = toolCalls.some((toolCall) =>
    isFileMutationTool(toolCall.name)
  );
  const onlyFileMutations = toolCalls.every((toolCall) =>
    isFileMutationTool(toolCall.name)
  );

  const title = onlyFileMutations
    ? t("toolAuthorization.fileTitle")
    : t("toolAuthorization.title");
  const message = onlyFileMutations
    ? t("toolAuthorization.fileMessage")
    : hasFileMutation
    ? t("toolAuthorization.mixedMessage")
    : t("toolAuthorization.message");

  return (
    <section className="tool-authorization-prompt" aria-label={title}>
      <div className="tool-authorization-prompt-heading">
        <span className="tool-authorization-prompt-icon" aria-hidden="true">
          <ShieldAlert size={14} />
        </span>
        <div className="tool-authorization-prompt-copy">
          <strong>{title}</strong>
          <p>{message}</p>
        </div>
      </div>
      <div className="tool-authorization-prompt-list">
        {toolCalls.map((toolCall) => {
          const authorizationId =
            toolCall.authorizationId ??
            `${toolCall.name}-${toolCall.callId ?? toolCall.arguments}`;
          const isSubmitting = submittingAuthorizationId === authorizationId;

          return (
            <AuthorizationToolItem
              key={authorizationId}
              toolCall={toolCall}
              isSubmitting={isSubmitting}
              onApprove={(item) => {
                setSubmittingAuthorizationId(
                  item.authorizationId ?? authorizationId
                );
                onApprove(item);
              }}
              onApproveAlways={(item) => {
                setSubmittingAuthorizationId(
                  item.authorizationId ?? authorizationId
                );
                onApproveAlways(item);
              }}
              onReject={(item, reason) => {
                setSubmittingAuthorizationId(
                  item.authorizationId ?? authorizationId
                );
                onReject(item, reason);
              }}
            />
          );
        })}
      </div>
    </section>
  );
};
