import { Network } from "lucide-react";
import { useI18n } from "../../../i18n";
import type { McpServerConfig } from "./types";

type McpSettingsSummaryProps = {
  servers: McpServerConfig[];
};

export function McpSettingsSummary({
  servers,
}: McpSettingsSummaryProps): React.JSX.Element {
  const { t } = useI18n();
  const enabledCount = servers.filter((server) => server.enabled).length;
  const projectCount = servers.filter((server) => server.scope === "project").length;

  return (
    <div className="api-settings-summary-grid">
      <div className="api-settings-summary-card">
        <Network size={15} strokeWidth={1.8} />
        <span>{servers.length}</span>
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
      <div className="api-settings-summary-card">
        <Network size={15} strokeWidth={1.8} />
        <span>{projectCount}</span>
        <small>
          {t("settings.mcpProjectCount", { defaultValue: "Project scope" })}
        </small>
      </div>
    </div>
  );
}
