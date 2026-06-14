import { MessageSquareText } from "lucide-react";
import { useMemo } from "react";
import { useI18n } from "../../../i18n";
import type { SystemPromptItem } from "./types";

type SystemPromptSummaryProps = {
  prompts: SystemPromptItem[];
};

export function SystemPromptSummary({
  prompts,
}: SystemPromptSummaryProps): React.JSX.Element {
  const { t } = useI18n();
  const activePrompts = useMemo(
    () => prompts.filter((prompt) => prompt.isActive),
    [prompts]
  );
  const activeNames = useMemo(
    () => activePrompts.map((prompt) => prompt.name).join(", ") || "-",
    [activePrompts]
  );

  return (
    <div className="api-settings-summary-grid">
      <div className="api-settings-summary-card">
        <MessageSquareText size={15} strokeWidth={1.8} />
        <span>{activePrompts.length}</span>
        <small>
          {t("settings.systemPromptActiveCount", {
            defaultValue: "Active prompts",
          })}
        </small>
      </div>
      <div className="api-settings-summary-card wide">
        <MessageSquareText size={15} strokeWidth={1.8} />
        <span>{activeNames}</span>
        <small>
          {t("settings.systemPromptActiveNames", {
            defaultValue: "Active prompt names",
          })}
        </small>
      </div>
      <div className="api-settings-summary-card">
        <MessageSquareText size={15} strokeWidth={1.8} />
        <span>{prompts.length}</span>
        <small>
          {t("settings.systemPromptTotalCount", {
            defaultValue: "Total prompts",
          })}
        </small>
      </div>
    </div>
  );
}
