import { Bot, Boxes, ShieldCheck } from "lucide-react";
import { useMemo } from "react";
import { useI18n } from "../../../i18n";
import { countTools } from "./subAgentUtils";
import type { SubAgentItem } from "./types";

type SubAgentSummaryProps = {
  agents: SubAgentItem[];
  availableToolCount: number;
};

export function SubAgentSummary({
  agents,
  availableToolCount,
}: SubAgentSummaryProps): React.JSX.Element {
  const { t } = useI18n();
  const toolCount = useMemo(
    () =>
      agents.reduce(
        (total, agent) => total + countTools(agent, availableToolCount),
        0
      ),
    [agents, availableToolCount]
  );
  const builtinCount = useMemo(
    () => agents.filter((agent) => agent.builtin).length,
    [agents]
  );

  return (
    <div className="api-settings-summary-grid sub-agent-summary-grid">
      <div className="api-settings-summary-card">
        <Bot size={15} strokeWidth={1.8} />
        <span>{agents.length}</span>
        <small>
          {t("settings.subAgentTotalCount", {
            defaultValue: "Total sub-agents",
          })}
        </small>
      </div>
      <div className="api-settings-summary-card">
        <ShieldCheck size={15} strokeWidth={1.8} />
        <span>{builtinCount}</span>
        <small>
          {t("settings.subAgentBuiltinCount", { defaultValue: "Built-in" })}
        </small>
      </div>
      <div className="api-settings-summary-card">
        <Boxes size={15} strokeWidth={1.8} />
        <span>{toolCount}</span>
        <small>
          {t("settings.subAgentToolCount", {
            defaultValue: "Configured tools",
          })}
        </small>
      </div>
    </div>
  );
}
