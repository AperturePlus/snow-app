import { Loader2 } from "lucide-react";

import { useI18n } from "../../../i18n";

type ChatsSectionProps = {
  isSwitchingDirectory: boolean;
};

export function ChatsSection({
  isSwitchingDirectory,
}: ChatsSectionProps): React.JSX.Element {
  const { t } = useI18n();

  return (
    <div className="sidebar-section">
      <div className="section-header">
        <span className="section-title">
          {t("sidebar.chats", { defaultValue: "Chats" })}
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
            {t("sidebar.noChats", { defaultValue: "No chats" })}
          </span>
        )}
      </div>
    </div>
  );
}
