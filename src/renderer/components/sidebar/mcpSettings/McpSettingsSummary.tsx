import { Network } from "lucide-react";
import { useI18n } from "../../../i18n";

type McpSettingsSummaryProps = {
  totalCount: number;
  enabledCount: number;
};

export function McpSettingsSummary({
  totalCount,
  enabledCount,
}: McpSettingsSummaryProps): React.JSX.Element {
  const { t } = useI18n();

  return (
    <div className="api-settings-summary-grid mcp-settings-summary-grid">
      <div className="api-settings-summary-card wide">
        <Network size={15} strokeWidth={1.8} />
        <span>{totalCount}</span>
        <small>
          {t("settings.mcpServerCount", { defaultValue: "Servers" })}
        </small>
      </div>
      <div className="api-settings-summary-card wide">
        <Network size={15} strokeWidth={1.8} />
        <span>{enabledCount}</span>
        <small>
          {t("settings.mcpEnabledCount", { defaultValue: "Enabled servers" })}
        </small>
      </div>
    </div>
  );
}
