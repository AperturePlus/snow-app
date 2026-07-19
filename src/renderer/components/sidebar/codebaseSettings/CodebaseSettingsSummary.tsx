import { BrainCircuit, Network } from "lucide-react";
import { useI18n } from "../../../i18n";
import { EMBEDDING_TYPE_OPTIONS } from "./codebaseSettingsConstants";
import type { CodebaseSettings } from "./types";

type CodebaseSettingsSummaryProps = {
  preview: CodebaseSettings;
  lastSaved: CodebaseSettings;
};

export function CodebaseSettingsSummary({
  preview,
  lastSaved,
}: CodebaseSettingsSummaryProps): React.JSX.Element {
  const { t } = useI18n();
  const embeddingLabel =
    EMBEDDING_TYPE_OPTIONS.find(
      (option) => option.value === preview.embeddingType
    )?.label ?? preview.embeddingType;
  const sourceLabel =
    lastSaved.source === "snow-cli"
      ? t("settings.sourceSnowCli", { defaultValue: "Snow CLI" })
      : t("settings.sourceManual", { defaultValue: "Manual" });

  return (
    <div className="api-settings-summary-grid">
      <div className="api-settings-summary-card">
        <BrainCircuit size={15} strokeWidth={1.8} />
        <span>{embeddingLabel}</span>
        <small>
          {t("settings.codebaseEmbeddingProvider", {
            defaultValue: "Embedding provider",
          })}
        </small>
      </div>
      <div className="api-settings-summary-card">
        <Network size={15} strokeWidth={1.8} />
        <span>{sourceLabel}</span>
        <small>{t("settings.source", { defaultValue: "Source" })}</small>
      </div>
    </div>
  );
}
