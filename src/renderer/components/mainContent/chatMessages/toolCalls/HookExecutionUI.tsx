import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronRight,
  ShieldQuestion,
  X,
  XCircle,
  Webhook,
} from "lucide-react";
import { useI18n } from "../../../../i18n";
import type {
  HookExecutionRecord,
  HookExecutionStatus,
} from "../utils/conversationTypes";
import type { ToolCategory } from "./shared/ToolNameBadge";
import { ToolNameBadge } from "./shared/ToolNameBadge";

export type { HookExecutionRecord, HookExecutionStatus };

type HookExecutionUIProps = {
  executions: HookExecutionRecord[];
};

const HOOK_DISPLAY_NAMES: Record<string, string> = {
  onUserMessage: "onUserMessage",
  beforeToolCall: "beforeToolCall",
  afterToolCall: "afterToolCall",
  toolConfirmation: "toolConfirmation",
  onSubAgentComplete: "onSubAgentComplete",
  beforeCompress: "beforeCompress",
  onSessionStart: "onSessionStart",
  onStop: "onStop",
  beforeSubAgentStart: "beforeSubAgentStart",
};

const getHookDisplayName = (hookType: string): string =>
  HOOK_DISPLAY_NAMES[hookType] ?? hookType;

const getHookCategory = (hookType: string): ToolCategory => {
  if (hookType.includes("Tool")) return "generic";
  if (hookType.includes("User")) return "interaction";
  if (hookType.includes("SubAgent")) return "agent";
  return "generic";
};

const StatusIcon = ({ status }: { status: HookExecutionStatus }) => {
  if (status === "pass") {
    return (
      <CheckCircle2
        size={13}
        className="hook-exec-status-icon hook-exec-status-pass"
        aria-hidden="true"
      />
    );
  }
  if (status === "warn") {
    return (
      <AlertTriangle
        size={13}
        className="hook-exec-status-icon hook-exec-status-warn"
        aria-hidden="true"
      />
    );
  }
  if (status === "needsDecision") {
    return (
      <ShieldQuestion
        size={13}
        className="hook-exec-status-icon hook-exec-status-decision"
        aria-hidden="true"
      />
    );
  }
  return (
    <XCircle
      size={13}
      className="hook-exec-status-icon hook-exec-status-abort"
      aria-hidden="true"
    />
  );
};

const formatActionOutput = (
  record: HookExecutionRecord["results"][number]
): string => {
  const parts: string[] = [];
  if (record.command) {
    parts.push(`$ ${record.command}`);
  }
  if (record.output) {
    parts.push(record.output);
  }
  if (record.error) {
    parts.push(record.error);
  }
  if (record.additionalContext) {
    parts.push(`[Context]\n${record.additionalContext}`);
  }
  return parts.join("\n");
};

const HookExecutionItem = ({
  record,
}: {
  record: HookExecutionRecord;
}): React.JSX.Element => {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(Boolean(record.pendingDecision));

  const displayName = getHookDisplayName(record.hookType);
  const category = getHookCategory(record.hookType);

  const hasDetails = record.results.length > 0 || Boolean(record.blockMessage);

  const detailOutput = useMemo(() => {
    if (record.blockMessage) {
      return record.blockMessage;
    }
    return record.results
      .map(formatActionOutput)
      .filter(Boolean)
      .join("\n\n---\n\n");
  }, [record.results, record.blockMessage]);

  const actionSummary =
    record.executedActions > 0 || record.skippedActions > 0
      ? `${record.executedActions}/${
          record.executedActions + record.skippedActions
        }`
      : null;

  return (
    <details
      className={`hook-exec-item hook-exec-item--${record.status}`}
      open={expanded}
      onToggle={(e) => setExpanded(e.currentTarget.open)}
    >
      <summary className="hook-exec-item-header">
        <StatusIcon status={record.status} />
        <ToolNameBadge name={displayName} category={category} />
        <span className="hook-exec-item-sep" aria-hidden="true">
          /
        </span>
        <span className="hook-exec-item-label">
          {t(`hookExecution.status.${record.status}`, {
            defaultValue: record.status,
          })}
        </span>
        {actionSummary ? (
          <span className="hook-exec-item-actions">
            {t("hookExecution.actionsExecuted", {
              defaultValue: "{{count}} actions",
              values: { count: actionSummary },
            })}
          </span>
        ) : null}
        {hasDetails ? (
          <ChevronRight
            className={`hook-exec-item-chevron ${
              expanded ? "hook-exec-item-chevron--open" : ""
            }`}
            size={12}
            aria-hidden="true"
          />
        ) : null}
      </summary>
      {record.pendingDecision && record.decisionMessage ? (
        <div className="hook-exec-decision">
          <p className="hook-exec-decision-message">{record.decisionMessage}</p>
          <div className="hook-exec-decision-buttons">
            <button
              type="button"
              className="hook-exec-decision-btn hook-exec-decision-approve"
              onClick={() => record._resolveDecision?.(true)}
            >
              <Check size={13} />
              {t("hookExecution.approve", { defaultValue: "Approve" })}
            </button>
            <button
              type="button"
              className="hook-exec-decision-btn hook-exec-decision-reject"
              onClick={() => record._resolveDecision?.(false)}
            >
              <X size={13} />
              {t("hookExecution.reject", { defaultValue: "Reject" })}
            </button>
          </div>
        </div>
      ) : null}
      {hasDetails && detailOutput ? (
        <div className="hook-exec-item-body">
          <pre className="hook-exec-item-output">{detailOutput}</pre>
        </div>
      ) : null}
    </details>
  );
};

export const HookExecutionUI = ({
  executions,
}: HookExecutionUIProps): React.JSX.Element | null => {
  const { t } = useI18n();

  // Filter out records where no actions were executed (all hooks were
  // disabled or their matchers did not match the context).  These records
  // carry no useful information — showing them only clutters the UI with
  // empty "0/0 actions" entries.
  const visibleExecutions = executions.filter(
    (e) => e.executedActions > 0 || e.pendingDecision
  );

  if (visibleExecutions.length === 0) {
    return null;
  }

  const hasFailure = visibleExecutions.some(
    (e) => e.status === "abort" || e.status === "error"
  );
  const hasWarning = visibleExecutions.some((e) => e.status === "warn");

  return (
    <div
      className={`hook-exec-group ${
        hasFailure ? "hook-exec-group--has-failure" : ""
      } ${hasWarning ? "hook-exec-group--has-warning" : ""}`}
    >
      <div className="hook-exec-group-header">
        <Webhook size={12} aria-hidden="true" />
        <span className="hook-exec-group-title">
          {t("hookExecution.title", { defaultValue: "Hooks" })}
        </span>
        <span className="hook-exec-group-count">
          {t("hookExecution.count", {
            defaultValue: "{{count}} hooks",
            values: { count: visibleExecutions.length },
          })}
        </span>
      </div>
      <div className="hook-exec-group-list">
        {visibleExecutions.map((record, index) => (
          <HookExecutionItem
            key={`${record.hookType}-${record.timestamp}-${index}`}
            record={record}
          />
        ))}
      </div>
    </div>
  );
};
