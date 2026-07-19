import { Link } from "lucide-react";
import { useI18n } from "../../../i18n";

type HooksSettingsSummaryProps = {
  totalCount: number;
  configuredCount: number;
  enabledCount: number;
};

export function HooksSettingsSummary({
  totalCount,
  configuredCount,
  enabledCount,
}: HooksSettingsSummaryProps): React.JSX.Element {
  const { t } = useI18n();

  return (
    <div className="api-settings-summary-grid hooks-settings-summary-grid">
      <div className="api-settings-summary-card wide">
        <Link size={15} strokeWidth={1.8} />
        <span>{totalCount}</span>
        <small>
          {t("settings.hooksAvailableCount", {
            defaultValue: "Available hooks",
          })}
        </small>
      </div>
      <div className="api-settings-summary-card wide">
        <Link size={15} strokeWidth={1.8} />
        <span>{configuredCount}</span>
        <small>
          {t("settings.hooksConfiguredCount", {
            defaultValue: "Configured hooks",
          })}
        </small>
      </div>
      <div className="api-settings-summary-card wide">
        <Link size={15} strokeWidth={1.8} />
        <span>{enabledCount}</span>
        <small>
          {t("settings.hooksEnabledCount", {
            defaultValue: "Enabled hooks",
          })}
        </small>
      </div>
    </div>
  );
}
