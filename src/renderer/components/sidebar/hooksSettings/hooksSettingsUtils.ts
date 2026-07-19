import type {
  HookAction,
  HookConfigInput,
  HookConfigRecord,
  HookRule,
  HookScope,
  HookType,
} from "../../../../preload";
import type {
  HookActionDraft,
  HookConfigDraft,
  HookRuleDraft,
} from "./types";

const createHookItemId = (): string =>
  `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const createHookActionDraft = (): HookActionDraft => ({
  id: createHookItemId(),
  type: "command",
  command: "",
  prompt: "",
  content: "",
  timeout: "",
  enabled: true,
});

export const createHookRuleDraft = (): HookRuleDraft => ({
  id: createHookItemId(),
  description: "",
  matcher: "",
  hooks: [createHookActionDraft()],
});

export const isActionTypeAllowed = (
  hookType: HookType,
  actionType: HookActionDraft["type"]
): boolean => {
  if (actionType === "prompt") {
    return hookType === "onSubAgentComplete" || hookType === "onStop";
  }
  if (actionType === "context") {
    return (
      hookType === "onSessionStart" ||
      hookType === "onUserMessage" ||
      hookType === "beforeSubAgentStart"
    );
  }
  return true;
};

export const rulesFromJson = (rulesJson: string): HookRule[] => {
  try {
    const parsed = JSON.parse(rulesJson || "[]");
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((rule): rule is HookRule => {
      if (!rule || typeof rule !== "object") {
        return false;
      }
      return (
        typeof (rule as HookRule).description === "string" &&
        Array.isArray((rule as HookRule).hooks)
      );
    });
  } catch {
    return [];
  }
};

export const rulesToJson = (rules: HookRule[]): string => {
  const normalized = rules.map((rule) => ({
    description: rule.description,
    ...(rule.matcher ? { matcher: rule.matcher } : {}),
    hooks: rule.hooks.map((action) => normalizeActionForJson(action)),
  }));
  return JSON.stringify(normalized, null, 2);
};

const normalizeActionForJson = (action: HookAction): HookAction => {
  const result: HookAction = {
    type: action.type,
    enabled: action.enabled !== false,
  };
  if (action.type === "command" && action.command) {
    result.command = action.command;
  }
  if (action.type === "prompt" && action.prompt) {
    result.prompt = action.prompt;
  }
  if (action.type === "context" && action.content) {
    result.content = action.content;
  }
  if (action.timeout !== undefined && action.timeout > 0) {
    result.timeout = action.timeout;
  }
  return result;
};

export const toDraft = (record: HookConfigRecord): HookConfigDraft => {
  const rules = rulesFromJson(record.rulesJson);
  return {
    hookType: record.hookType as HookType,
    scope: record.scope,
    projectId: record.projectId,
    rules: rules.map((rule) => toRuleDraft(rule)),
    updatedAt: record.updatedAt,
  };
};

const toRuleDraft = (rule: HookRule): HookRuleDraft => ({
  id: createHookItemId(),
  description: rule.description,
  matcher: rule.matcher || "",
  hooks: rule.hooks.map((action) => toActionDraft(action)),
});

const toActionDraft = (action: HookAction): HookActionDraft => ({
  id: createHookItemId(),
  type: action.type,
  command: action.command || "",
  prompt: action.prompt || "",
  content: action.content || "",
  timeout: action.timeout ? String(action.timeout) : "",
  enabled: action.enabled !== false,
});

export const toInput = (draft: HookConfigDraft): HookConfigInput => {
  const rules: HookRule[] = draft.rules.map((rule) => ({
    description: rule.description.trim(),
    ...(rule.matcher.trim() ? { matcher: rule.matcher.trim() } : {}),
    hooks: rule.hooks.map((action) => toActionForInput(action)),
  }));
  return {
    hookType: draft.hookType,
    scope: draft.scope,
    projectId: draft.scope === "project" ? draft.projectId : undefined,
    rulesJson: rulesToJson(rules),
  };
};

const toActionForInput = (action: HookActionDraft): HookAction => {
  const result: HookAction = {
    type: action.type,
    enabled: action.enabled,
  };
  if (action.type === "command") {
    result.command = action.command.trim();
  }
  if (action.type === "prompt") {
    result.prompt = action.prompt.trim();
  }
  if (action.type === "context") {
    result.content = action.content.trim();
  }
  const timeoutMs = action.timeout.trim()
    ? Number(action.timeout)
    : NaN;
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    result.timeout = Math.floor(timeoutMs);
  }
  return result;
};

export const hasExecutableAction = (draft: HookConfigDraft): boolean => {
  return draft.rules.some((rule) =>
    rule.hooks.some((action) => {
      if (!action.enabled) {
        return false;
      }
      if (action.type === "command") {
        return action.command.trim().length > 0;
      }
      if (action.type === "prompt") {
        return action.prompt.trim().length > 0;
      }
      if (action.type === "context") {
        return action.content.trim().length > 0;
      }
      return false;
    })
  );
};

export const countEnabledActions = (draft: HookConfigDraft): number => {
  return draft.rules.reduce(
    (total, rule) =>
      total + rule.hooks.filter((action) => action.enabled).length,
    0
  );
};

export const countTotalActions = (draft: HookConfigDraft): number => {
  return draft.rules.reduce((total, rule) => total + rule.hooks.length, 0);
};
