import { splitDraftText } from "../components/mainContent/chatInput/fileTagUtils";
import type { PluginView } from "./types";
import {
  getPluginProjectBinding,
  getPluginDraftContextRevision,
  subscribePluginDraftContext,
} from "./pluginDraft";
import type {
  PromptCodebaseContextOptions,
  PromptContextReport,
  PromptContextSource,
  PromptOptimizationResult,
  PromptProjectContextOptions,
  PromptProjectContextStatus,
} from "../../preload/types/promptOptimization";
import { getActiveLocale } from "../i18n";
export type {
  PromptCodebaseContextOptions,
  PromptContextReport,
  PromptContextSource,
  PromptOptimizationResult,
};
export type OptimizePromptOptions = {
  draft: string;
  draftToken?: string;
  codebaseContext?: PromptCodebaseContextOptions;
  contextHandle?: string;
  selectedSourceIds?: string[];
  onProgress?: (phase: string) => void;
  conversationId?: string;
  apiProfile?: string;
  model?: string;
  contextRounds?: number;
  includeContext?: boolean;
  optimizationInstructions?: string;
  onChunk?: (delta: string) => void;
  signal?: AbortSignal;
};
export type PluginAiApi = {
  capabilities?: {
    promptOptimization: {
      projectContext: 1;
      sourceReview: 1;
      diff: 1;
      queryPlanner: 1;
    };
  };
  optimizePrompt?: (
    options: OptimizePromptOptions,
  ) => Promise<PromptOptimizationResult>;
  getProjectContext?: (
    options: PromptProjectContextOptions,
  ) => Promise<PromptProjectContextStatus>;
  revokeProjectContextAccess?: (
    options: PromptProjectContextOptions,
  ) => Promise<boolean>;
};
const authorizers = new WeakMap<
  PluginAiApi,
  (
    options: OptimizePromptOptions,
    confirm: (message: string) => Promise<boolean>,
  ) => Promise<void>
>();
export const authorizePluginProjectContext = async (
  api: PluginAiApi,
  options: OptimizePromptOptions,
  confirm: (message: string) => Promise<boolean>,
): Promise<void> => {
  if (!options.codebaseContext || options.codebaseContext.mode === "off")
    return;
  const authorize = authorizers.get(api);
  if (!authorize) throw new Error("Project context unavailable");
  await authorize(options, confirm);
};
subscribePluginDraftContext(() => {
  if (typeof window.snow.invalidatePromptProjectContext === "function")
    void window.snow.invalidatePromptProjectContext().catch(() => undefined);
});
export const createPluginAiApi = async (
  plugin: PluginView,
): Promise<PluginAiApi> => {
  const backend = window.snow;
  if (
    typeof backend.optimizePrompt !== "function" ||
    typeof backend.abortPromptOptimization !== "function"
  )
    return {};
  const capabilityRevision = getPluginDraftContextRevision();
  const supported =
    typeof backend.getPromptContextCapabilities === "function" &&
    (await backend.getPromptContextCapabilities().catch(() => false));
  if (capabilityRevision !== getPluginDraftContextRevision())
    throw new DOMException("Project context changed", "AbortError");
  const safeOptions = (options: PromptProjectContextOptions) => ({
    apiProfile: options.apiProfile,
    model: options.model,
    codebaseContext: options.codebaseContext,
  });
  const bindingFor = async (
    options: PromptProjectContextOptions,
    draft?: string,
  ): Promise<PromptProjectContextStatus> => {
    if (!supported || !plugin.privacy.includes("projectContext"))
      throw new Error("Project context declaration or capability unavailable");
    const revision = getPluginDraftContextRevision();
    const binding = getPluginProjectBinding(
      plugin.pluginId,
      options.draftToken,
      draft,
    );
    if (!binding)
      return {
        bindingHandle: "",
        projectId: "",
        status: "no_project",
        authorized: false,
        services: [],
      };
    const result = await backend.bindPromptProjectContext(binding);
    if (revision !== getPluginDraftContextRevision())
      throw new DOMException("Project context changed", "AbortError");
    getPluginProjectBinding(plugin.pluginId, options.draftToken, draft);
    if (typeof result !== "string")
      return { ...result, bindingHandle: "", authorized: false, services: [] };
    return {
      bindingHandle: result,
      projectId: binding.projectId,
      status: "bound",
      authorized: false,
      services: [],
    };
  };
  const unavailableStates = new Set([
    "no_project",
    "remote_project_unsupported",
    "worktree_index_unavailable",
    "project_index_disabled",
    "index_empty",
    "index_unavailable",
    "indexing",
    "context_tool_disabled",
    "project_root_unavailable",
    "index_model_or_dimension_mismatch",
  ]);
  const readContextStatus = async (
    options: PromptProjectContextOptions,
    draft?: string,
  ): Promise<PromptProjectContextStatus> => {
    const revision = getPluginDraftContextRevision();
    const bound = await bindingFor(options, draft);
    const result = bound.bindingHandle
      ? await backend.getPromptProjectContext(
          bound.bindingHandle,
          safeOptions(options),
        )
      : bound;
    if (revision !== getPluginDraftContextRevision())
      throw new DOMException("Project context changed", "AbortError");
    getPluginProjectBinding(plugin.pluginId, options.draftToken, draft);
    return result;
  };
  const api: PluginAiApi = {
    ...(supported
      ? {
          capabilities: {
            promptOptimization: {
              projectContext: 1 as const,
              sourceReview: 1 as const,
              diff: 1 as const,
              queryPlanner: 1 as const,
            },
          },
          getProjectContext: (options: PromptProjectContextOptions = {}) =>
            readContextStatus(options),
          revokeProjectContextAccess: async (
            options: PromptProjectContextOptions = {},
          ) => {
            const revision = getPluginDraftContextRevision();
            const bound = await bindingFor(options);
            if (!bound.bindingHandle) return false;
            const result = await backend.revokePromptProjectContext(
              bound.bindingHandle,
              safeOptions(options),
            );
            if (revision !== getPluginDraftContextRevision())
              throw new DOMException("Project context changed", "AbortError");
            getPluginProjectBinding(plugin.pluginId, options.draftToken);
            return result;
          },
        }
      : {}),
    optimizePrompt: async (options) => {
      if (
        !options ||
        typeof options.draft !== "string" ||
        !options.draft.trim()
      )
        throw new Error(
          "A non-empty, explicitly user-requested draft is required",
        );
      if (splitDraftText(options.draft).chips.length)
        throw new Error("draft must be plain text without encoded chips");
      if (
        options.includeContext === true &&
        !plugin.privacy.includes("messages")
      )
        throw new Error(
          "Declare 'messages' in plugin privacy scopes to include context",
        );
      if (
        options.includeContext !== undefined &&
        typeof options.includeContext !== "boolean"
      )
        throw new Error("includeContext must be a boolean");
      for (const key of ["conversationId", "apiProfile", "model"] as const)
        if (options[key] !== undefined && typeof options[key] !== "string")
          throw new Error(`Invalid ${key}`);
      if (
        options.contextRounds !== undefined &&
        (!Number.isInteger(options.contextRounds) || options.contextRounds < 0)
      )
        throw new Error("contextRounds must be a non-negative integer");
      if (
        options.optimizationInstructions !== undefined &&
        (typeof options.optimizationInstructions !== "string" ||
          Array.from(options.optimizationInstructions).length > 8000)
      )
        throw new Error("Invalid optimization instructions");
      if (
        options.onChunk !== undefined &&
        typeof options.onChunk !== "function"
      )
        throw new Error("onChunk must be a function");
      if (
        options.onProgress !== undefined &&
        typeof options.onProgress !== "function"
      )
        throw new Error("onProgress must be a function");
      let bindingHandle: string | undefined;
      let degradation: PromptContextReport | undefined;
      let omitHistory = false;
      if (options.signal?.aborted)
        throw new DOMException("Optimization cancelled", "AbortError");
      if (
        options.contextHandle &&
        (!options.codebaseContext || options.codebaseContext.mode === "off")
      )
        throw new DOMException("Source review options changed", "AbortError");
      if (
        (options.codebaseContext && options.codebaseContext.mode !== "off") ||
        options.contextHandle
      ) {
        if (!options.draftToken)
          throw new Error("Project context requires a captured draft token");
        const status = await readContextStatus(options, options.draft);
        if (options.signal?.aborted)
          throw new DOMException("Optimization cancelled", "AbortError");
        bindingHandle = status.bindingHandle || undefined;
        const binding = getPluginProjectBinding(
          plugin.pluginId,
          options.draftToken,
          options.draft,
        );
        if (binding) {
          if (
            options.conversationId !== undefined &&
            options.conversationId !== binding.conversationId
          )
            throw new DOMException(
              "Conversation context changed",
              "AbortError",
            );
          options = { ...options, conversationId: binding.conversationId };
        }
        if (unavailableStates.has(status.status)) {
          if (options.contextHandle)
            throw new DOMException(
              "Source review context unavailable",
              "AbortError",
            );
          omitHistory =
            !bindingHandle || status.status === "project_root_unavailable";
          degradation = {
            outcome: "degraded",
            reason: status.status,
            sources: [],
            warnings:
              omitHistory && options.includeContext
                ? ["history_omitted_no_project_binding"]
                : [],
            indexState:
              status.status === "indexing" ? "indexing" : "unavailable",
            queryKind: "none",
            characters: 0,
            elapsedMs: 0,
            cacheHit: false,
            truncated: false,
          };
        } else if (!status.authorized) {
          if (options.contextHandle)
            throw new DOMException(
              "Source review authorization changed",
              "AbortError",
            );
          throw new Error("Host project context authorization required");
        }
      }
      const { signal, onChunk } = options;
      if (signal?.aborted)
        throw new DOMException("Optimization cancelled", "AbortError");
      const streamId = crypto.randomUUID();
      let active = true;
      let rejectAbort: (error: Error) => void = () => undefined;
      const cancelled = new Promise<never>((_, reject) => {
        rejectAbort = reject;
      });
      const abort = (): void => {
        if (!active) return;
        active = false;
        void backend.abortPromptOptimization(streamId).catch(() => undefined);
        rejectAbort(new DOMException("Optimization cancelled", "AbortError"));
      };
      signal?.addEventListener("abort", abort, { once: true });
      try {
        const result = backend.optimizePrompt(
          {
            streamId,
            draft: options.draft,
            conversationId: omitHistory ? undefined : options.conversationId,
            apiProfile: options.apiProfile,
            model: options.model,
            contextRounds: options.contextRounds,
            includeContext: !omitHistory && options.includeContext === true,
            optimizationInstructions: options.optimizationInstructions,
            bindingHandle,
            codebaseContext: degradation ? undefined : options.codebaseContext,
            contextHandle: degradation ? undefined : options.contextHandle,
            selectedSourceIds: degradation
              ? undefined
              : options.selectedSourceIds,
          },
          (delta) => {
            if (active && !signal?.aborted) onChunk?.(delta);
          },
          (phase) => {
            if (active && !signal?.aborted) options.onProgress?.(phase);
          },
        );
        const output = await Promise.race([result, cancelled]);
        return degradation
          ? {
              content: output.content,
              contextReport: degradation,
              warnings: [...(output.warnings ?? []), ...degradation.warnings],
            }
          : output;
      } finally {
        active = false;
        signal?.removeEventListener("abort", abort);
      }
    },
  };
  if (supported)
    authorizers.set(api, async (options, confirm) => {
      if (!options.draftToken)
        throw new Error("Project context requires a captured draft token");
      const status = await readContextStatus(options, options.draft);
      const handle = status.bindingHandle;
      if (options.signal?.aborted)
        throw new DOMException("Action cancelled", "AbortError");
      if (
        options.contextHandle &&
        (!status.authorized || unavailableStates.has(status.status))
      )
        throw new DOMException("Source review context changed", "AbortError");
      if (unavailableStates.has(status.status) || status.authorized) return;
      if (!status.services.length)
        throw new Error("Project context unavailable");
      const locale = getActiveLocale();
      const project = status.projectName || status.projectId;
      const services = status.services
        .map((s) => `${s.kind}: ${s.label}`)
        .join("\n");
      const message =
        locale === "en"
          ? `Allow project context for ${project}? Your draft query may be sent to the embedding service and selected code to the optimization model. Planner and reranking may incur additional API costs. Revoke access in the plugin panel. Native tool permissions still apply.\n${services}`
          : locale === "zh-TW"
            ? `允許專案「${project}」的程式碼上下文？草稿查詢可能送至嵌入服務，所選程式碼送至優化模型；規劃與重排可能產生額外 API 費用。可在插件面板撤回授權，仍受原生工具權限限制。\n${services}`
            : `允许项目「${project}」的代码上下文？草稿查询可能发送到嵌入服务，所选代码发送到优化模型；规划与重排可能产生额外 API 费用。可在插件面板撤回授权，仍受原生工具权限限制。\n${services}`;
      if (!(await confirm(message)))
        throw new DOMException("Project context declined", "AbortError");
      if (options.signal?.aborted)
        throw new DOMException("Action cancelled", "AbortError");
      getPluginProjectBinding(
        plugin.pluginId,
        options.draftToken,
        options.draft,
      );
      await backend.grantPromptProjectContext(handle, safeOptions(options));
      getPluginProjectBinding(
        plugin.pluginId,
        options.draftToken,
        options.draft,
      );
    });
  return api;
};
