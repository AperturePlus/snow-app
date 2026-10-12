export type PromptCodebaseContextOptions = {
  mode: "off" | "auto" | "always";
  budget: "fast" | "balanced";
  planner: "local" | "model";
  rerank: boolean;
  reviewSources: boolean;
  includePaths?: string[];
  excludePaths?: string[];
};
export type PromptContextSource = {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  matchKind: "exact" | "semantic" | "mixed";
  characters: number;
  freshness: "fresh" | "unknown";
  selected: boolean;
};
export type PromptContextReport = {
  outcome: "used" | "skipped" | "degraded" | "review_required";
  reason: string;
  sources: PromptContextSource[];
  warnings: string[];
  indexState: "fresh" | "stale" | "indexing" | "unknown" | "unavailable";
  queryKind: "exact" | "semantic" | "mixed" | "none";
  characters: number;
  elapsedMs: number;
  cacheHit: boolean;
  truncated: boolean;
};
export type PromptProjectContextOptions = {
  draftToken?: string;
  apiProfile?: string;
  model?: string;
  codebaseContext?: PromptCodebaseContextOptions;
};
export type PromptProjectContextStatus = {
  bindingHandle: string;
  projectId: string;
  projectName?: string;
  status: string;
  authorized: boolean;
  services: {
    kind: "embedding" | "optimization" | "reranking" | "planner";
    label: string;
  }[];
};
export type PromptProjectBinding = {
  pluginId: string;
  projectId: string;
  sessionKey: string;
  conversationId?: string;
  workspaceRoot?: string;
  worktreeId?: string;
};
export type PromptProjectBindingResult =
  | string
  | {
      projectId: string;
      status:
        | "no_project"
        | "remote_project_unsupported"
        | "worktree_index_unavailable";
    };
export type PromptOptimizationRequest = {
  streamId: string;
  draft: string;
  conversationId?: string;
  apiProfile?: string;
  model?: string;
  contextRounds?: number;
  includeContext?: boolean;
  optimizationInstructions?: string;
  bindingHandle?: string;
  codebaseContext?: PromptCodebaseContextOptions;
  contextHandle?: string;
  selectedSourceIds?: string[];
};
export type PromptOptimizationResult = {
  content: string;
  contextReport?: PromptContextReport;
  contextHandle?: string;
  reviewRequired?: boolean;
  warnings?: string[];
};
