import { ShieldX } from "lucide-react";
import { useI18n } from "../../../../../i18n";
import type { ToolRejection } from "./toolRejection";

type ToolRejectionNoticeProps = {
  rejection: ToolRejection;
};

export const ToolRejectionNotice = ({
  rejection,
}: ToolRejectionNoticeProps): React.JSX.Element => {
  const { t } = useI18n();

  return (
    <div className="tcn-rejection" role="note">
      <ShieldX size={12} className="tcn-rejection-icon" aria-hidden="true" />
      <span className="tcn-rejection-label">
        {t("toolCall.rejection.title", { defaultValue: "Rejected" })}
      </span>
      <span className="tcn-rejection-reason">
        {rejection.userProvided
          ? rejection.reason
          : t("toolCall.rejection.noReason", {
              defaultValue: "No reason provided by the user",
            })}
      </span>
    </div>
  );
};
