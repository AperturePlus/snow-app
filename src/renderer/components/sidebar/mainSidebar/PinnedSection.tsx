import { Loader2 } from "lucide-react";

import { useI18n } from "../../../i18n";

type PinnedSectionProps = {
  isSwitchingDirectory: boolean;
};

export function PinnedSection({
  isSwitchingDirectory,
}: PinnedSectionProps): React.JSX.Element {
  const { t } = useI18n();

  return (
    <div className="sidebar-section">
      <div className="section-header">
        <span className="section-title">
          {t("sidebar.pinned", { defaultValue: "Pinned" })}
        </span>
      </div>
      <div className="section-list">
        {isSwitchingDirectory ? (
          <span className="empty-text loading">
            <Loader2 className="spin" size={13} />
            {t("sidebar.loadingWorkspaceContent", {
              defaultValue: "Loading workspace content...",
            })}
          </span>
        ) : (
          <span className="empty-text">
            {t("sidebar.noPinnedItems", { defaultValue: "No pinned items" })}
          </span>
        )}
      </div>
    </div>
  );
}
