import { ShieldAlert } from "lucide-react";
import { useI18n } from "../../../i18n";
import type { SensitiveCommandConfig } from "./types";

type SensitiveCommandSummaryProps = {
  commands: SensitiveCommandConfig[];
};

export function SensitiveCommandSummary({
  commands,
}: SensitiveCommandSummaryProps): React.JSX.Element {
  const { t } = useI18n();
  const enabledCount = commands.filter((command) => command.enabled).length;
  const presetCount = commands.filter((command) => command.isPreset).length;

  return (
    <div className="api-settings-summary-grid">
      <div className="api-settings-summary-card">
        <ShieldAlert size={15} strokeWidth={1.8} />
        <span>{commands.length}</span>
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
        <span>{presetCount}</span>
        <small>
          {t("settings.sensitiveCommandPresetCount", {
            defaultValue: "Preset rules",
          })}
        </small>
      </div>
    </div>
  );
}
