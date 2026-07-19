import type {
  HookAction,
  HookActionType,
  HookConfigRecord,
  HookRule,
  HookScope,
  HookType,
} from "../../../../preload";

export type {
  HookAction,
  HookActionType,
  HookConfigRecord,
  HookRule,
  HookScope,
  HookType,
};

export type HookActionDraft = {
  id: string;
  type: HookActionType;
  command: string;
  prompt: string;
  content: string;
  timeout: string;
  enabled: boolean;
};

export type HookRuleDraft = {
  id: string;
  description: string;
  matcher: string;
  hooks: HookActionDraft[];
};

export type HookConfigDraft = {
  hookType: HookType;
  scope: HookScope;
  projectId: string;
  rules: HookRuleDraft[];
  updatedAt: string;
};

export type HookListItem = {
  hookType: HookType;
  scope: HookScope;
  projectId: string;
  ruleCount: number;
  enabledActionCount: number;
  totalActionCount: number;
  updatedAt: string;
};

export const SUPPORTED_HOOK_TYPES: HookType[] = [
  "onUserMessage",
  "beforeToolCall",
  "toolConfirmation",
  "afterToolCall",
  "onSubAgentComplete",
  "beforeCompress",
  "onSessionStart",
  "onStop",
  "beforeSubAgentStart",
];

export const TOOL_HOOK_TYPES: HookType[] = [
  "beforeToolCall",
  "toolConfirmation",
  "afterToolCall",
];
