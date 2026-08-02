import { ExternalLink, X } from "lucide-react";

import { useI18n } from "../../i18n";
import { GitDiffView } from "../common/GitDiffView";
import { getFileTypeIcon } from "../../utils/fileIcons";
import type { GitDiffResult, GitFileStatus } from "./git";
import type { OpenDiffTabCallback } from "./types";

type DiffViewerProps = {
  selectedFile: GitFileStatus;
  diffResult: GitDiffResult | null;
  diffLoading: boolean;
  onOpenInTab?: OpenDiffTabCallback;
  onClose?: () => void;
};

export function DiffViewer({
  selectedFile,
  diffResult,
  diffLoading,
  onOpenInTab,
  onClose,
}: DiffViewerProps): React.JSX.Element {
  const { t } = useI18n();

  return (
    <div className="diff-viewer">
      <div className="diff-viewer-header">
        {getFileTypeIcon(
          selectedFile.path.split("/").pop() ?? selectedFile.path,
          false,
          false,
          { size: 14, className: "diff-viewer-file-icon" }
        )}
        <span className="diff-viewer-file-name" title={selectedFile.path}>
          {selectedFile.path}
        </span>
        {(onOpenInTab || onClose) && (
          <div className="diff-viewer-actions">
            {onOpenInTab && (
              <button
                type="button"
                className="icon-btn"
                title={t("rightPanel.openInNewTab")}
                aria-label={t("rightPanel.openInNewTab")}
                onClick={() =>
                  onOpenInTab(selectedFile, diffResult, diffLoading)
                }
              >
                <ExternalLink size={14} strokeWidth={1.8} />
              </button>
            )}
            {onClose && (
              <button
                type="button"
                className="icon-btn"
                title={t("rightPanel.closeDiff")}
                aria-label={t("rightPanel.closeDiff")}
                onClick={onClose}
              >
                <X size={14} strokeWidth={1.8} />
              </button>
            )}
          </div>
        )}
      </div>
      {diffLoading ? (
        <div className="diff-viewer-loading">{t("rightPanel.loadingDiff")}</div>
      ) : diffResult?.isBinary ? (
        <div className="diff-viewer-binary">{t("rightPanel.binaryFile")}</div>
      ) : diffResult?.content ? (
        <div className="diff-viewer-content">
          <GitDiffView
            fileName={selectedFile.path}
            patch={diffResult.content}
          />
        </div>
      ) : (
        <div className="diff-viewer-empty">
          {t("rightPanel.noChangesToDisplay")}
        </div>
      )}
    </div>
  );
}
