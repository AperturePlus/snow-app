import { ShieldAlert } from "lucide-react";
import { useI18n } from "../../../i18n";

type SensitiveCommandSummaryProps = {
  totalCount: number;
  enabledCount: number;
  specialCount: number;
  specialLabel: string;
};

export function SensitiveCommandSummary({
  totalCount,
  enabledCount,
  specialCount,
  specialLabel,
}: SensitiveCommandSummaryProps): React.JSX.Element {
  const { t } = useI18n();

  return (
    <div className="api-settings-summary-grid">
      <div className="api-settings-summary-card">
        <ShieldAlert size={15} strokeWidth={1.8} />
        <span>{totalCount}</span>
        <small>
          {t("settings.sensitiveCommandCount", { defaultValue: "Rules" })}
        </small>
      </div>
      <div className="api-settings-summary-card wide">
        <ShieldAlert size={15} strokeWidth={1.8} />
        <span>{enabledCount}</span>
        <small>
          {t("settings.sensitiveCommandEnabledCount", {
            defaultValue: "Enabled rules",
          })}
        </small>
      </div>
      <div className="api-settings-summary-card">
        <ShieldAlert size={15} strokeWidth={1.8} />
        <span>{specialCount}</span>
        <small>{specialLabel}</small>
      </div>
    </div>
  );
}
