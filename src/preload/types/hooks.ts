export type HookScope = "global" | "project";

export type HookType =
  | "onUserMessage"
  | "beforeToolCall"
  | "toolConfirmation"
  | "afterToolCall"
  | "onSubAgentComplete"
  | "beforeCompress"
  | "onSessionStart"
  | "onStop"
  | "beforeSubAgentStart";

export type HookActionType = "command" | "prompt" | "context";

export type HookAction = {
  type: HookActionType;
  command?: string;
  prompt?: string;
  content?: string;
  timeout?: number;
  enabled?: boolean;
};

export type HookRule = {
  matcher?: string;
  description: string;
  hooks: HookAction[];
};

export type HookConfigInput = {
  hookType: HookType;
  scope: HookScope;
  projectId?: string;
  rulesJson: string;
};

export type HookConfigRecord = {
  hookType: string;
  scope: HookScope;
  projectId: string;
  rulesJson: string;
  updatedAt: string;
};

export type HookExecuteInput = {
  hookType: string;
  projectId?: string;
  contextJson: string;
};

export type HookActionResultRecord = {
  actionType: string;
  success: boolean;
  command?: string | null;
  exitCode?: number | null;
  output?: string | null;
  error?: string | null;
  additionalContext?: string | null;
};

export type HookExecuteResult = {
  success: boolean;
  results: HookActionResultRecord[];
  executedActions: number;
  skippedActions: number;
  softSignal?: boolean | null;
  blocked?: boolean | null;
  blockMessage?: string | null;
};
