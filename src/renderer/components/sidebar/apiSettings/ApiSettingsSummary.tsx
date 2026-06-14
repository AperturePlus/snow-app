import { Database, Server, Sparkles } from "lucide-react";
import { useI18n } from "../../../i18n";
import type { ApiConfigItem } from "./types";

type ApiSettingsSummaryProps = {
  configs: ApiConfigItem[];
};

export function ApiSettingsSummary({
  configs,
}: ApiSettingsSummaryProps): React.JSX.Element {
  const { t } = useI18n();
  const activeConfig = configs.find((config) => config.isActive) ?? configs[0];

  return (
    <div className="api-settings-summary-grid">
      <div className="api-settings-summary-card">
        <Database size={15} strokeWidth={1.8} />
        <span>{configs.length}</span>
        <small>{t("settings.apiProfiles", { defaultValue: "Profiles" })}</small>
      </div>
      <div className="api-settings-summary-card wide">
        <Server size={15} strokeWidth={1.8} />
        <span>{activeConfig?.requestMethod ?? "-"}</span>
        <small>
          {activeConfig?.baseUrl ||
            t("settings.noActiveApi", { defaultValue: "No active API" })}
        </small>
      </div>
      <div className="api-settings-summary-card">
        <Sparkles size={15} strokeWidth={1.8} />
        <span>{activeConfig?.advancedModel || "-"}</span>
        <small>
          {t("settings.apiPrimaryModel", { defaultValue: "Primary model" })}
        </small>
      </div>
    </div>
  );
}
