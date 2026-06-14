import { Globe, Route, Search } from "lucide-react";
import { useI18n } from "../../../i18n";
import type { ProxyBrowserSettingsValue } from "./types";

type ProxyBrowserSettingsSummaryProps = {
  preview: ProxyBrowserSettingsValue;
};

export function ProxyBrowserSettingsSummary({
  preview,
}: ProxyBrowserSettingsSummaryProps): React.JSX.Element {
  const { t } = useI18n();
  const proxyUrl = preview.enabled ? `http://127.0.0.1:${preview.port}` : "-";

  return (
    <div className="api-settings-summary-grid">
      <div className="api-settings-summary-card">
        <Globe size={15} strokeWidth={1.8} />
        <span>
          {preview.enabled
            ? t("settings.enabled", { defaultValue: "Enabled" })
            : t("settings.disabled", { defaultValue: "Disabled" })}
        </span>
        <small>{t("settings.proxyStatus", { defaultValue: "Proxy" })}</small>
      </div>
      <div className="api-settings-summary-card wide">
        <Route size={15} strokeWidth={1.8} />
        <span>{proxyUrl}</span>
        <small>
          {t("settings.proxyEndpoint", { defaultValue: "Proxy endpoint" })}
        </small>
      </div>
      <div className="api-settings-summary-card">
        <Search size={15} strokeWidth={1.8} />
        <span>{preview.searchEngine}</span>
        <small>
          {t("settings.searchEngine", { defaultValue: "Search engine" })}
        </small>
      </div>
    </div>
  );
}
