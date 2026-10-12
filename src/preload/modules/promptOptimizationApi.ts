import { ipcRenderer, type IpcRendererEvent } from "electron";
import type {
  PromptOptimizationRequest,
  PromptOptimizationResult,
  PromptProjectBinding,
  PromptProjectBindingResult,
  PromptProjectContextOptions,
  PromptProjectContextStatus,
} from "../types/promptOptimization";

const CHUNK_CHANNEL = "prompt:optimization:chunk";
const streams = new Set<string>();

export const promptOptimizationApi = {
  getPromptContextCapabilities: (): Promise<boolean> =>
    ipcRenderer.invoke("prompt:context:capabilities"),
  bindPromptProjectContext: (
    binding: PromptProjectBinding & { worktreeMode?: boolean },
  ): Promise<PromptProjectBindingResult> =>
    ipcRenderer.invoke("prompt:context:bind", binding),
  getPromptProjectContext: (
    handle: string,
    options: PromptProjectContextOptions,
  ): Promise<PromptProjectContextStatus> =>
    ipcRenderer.invoke("prompt:context:status", handle, options),
  grantPromptProjectContext: (
    handle: string,
    options: PromptProjectContextOptions,
  ): Promise<PromptProjectContextStatus> =>
    ipcRenderer.invoke("prompt:context:grant", handle, options),
  revokePromptProjectContext: (
    handle: string,
    options: PromptProjectContextOptions,
  ): Promise<boolean> =>
    ipcRenderer.invoke("prompt:context:revoke", handle, options),
  invalidatePromptProjectContext: (): Promise<boolean> =>
    ipcRenderer.invoke("prompt:context:invalidate"),
  getPromptContextSourcePreview: (
    handle: string,
    sourceId: string,
  ): Promise<string> =>
    ipcRenderer.invoke("prompt:context:preview", handle, sourceId),
  optimizePrompt: (
    request: PromptOptimizationRequest,
    onChunk: (delta: string) => void,
    onProgress?: (phase: string) => void,
  ): Promise<PromptOptimizationResult> => {
    if (
      !request ||
      typeof request.streamId !== "string" ||
      !request.streamId.trim() ||
      request.streamId !== request.streamId.trim()
    ) {
      return Promise.reject(new Error("Invalid prompt optimization stream ID"));
    }
    if (typeof onChunk !== "function") {
      return Promise.reject(
        new Error("Prompt optimization chunk callback is required"),
      );
    }
    if (streams.has(request.streamId)) {
      return Promise.reject(
        new Error("Prompt optimization stream is already running"),
      );
    }
    const streamId = request.streamId;
    streams.add(streamId);
    let callbackError: unknown;
    let callbackFailed = false;
    const handleChunk = (_event: IpcRendererEvent, payload: unknown): void => {
      if (!payload || typeof payload !== "object") return;
      const value = payload as { streamId?: unknown; delta?: unknown };
      if (
        value.streamId !== streamId ||
        typeof value.delta !== "string" ||
        !value.delta ||
        callbackFailed
      )
        return;
      try {
        onChunk(value.delta);
      } catch (error) {
        callbackError = error;
        callbackFailed = true;
        // Never leave an unhandled IPC rejection when a consumer throws.
        void ipcRenderer
          .invoke("prompt:optimization:abort", streamId)
          .catch(() => {});
      }
    };
    const handleProgress = (
      _event: IpcRendererEvent,
      payload: unknown,
    ): void => {
      if (!payload || typeof payload !== "object" || callbackFailed) return;
      const value = payload as { streamId?: unknown; phase?: unknown };
      if (
        value.streamId !== streamId ||
        typeof value.phase !== "string" ||
        !/^[a-z_]{1,64}$/.test(value.phase)
      )
        return;
      try {
        onProgress?.(value.phase);
      } catch {
        callbackFailed = true;
        callbackError = new Error("Progress callback failed");
        void ipcRenderer
          .invoke("prompt:optimization:abort", streamId)
          .catch(() => {});
      }
    };
    ipcRenderer.on("prompt:optimization:progress", handleProgress);
    ipcRenderer.on(CHUNK_CHANNEL, handleChunk);
    return ipcRenderer
      .invoke("prompt:optimization:run", request)
      .then((result: PromptOptimizationResult) => {
        if (callbackFailed) throw callbackError;
        return result;
      })
      .finally(() => {
        streams.delete(streamId);
        ipcRenderer.removeListener(CHUNK_CHANNEL, handleChunk);
        ipcRenderer.removeListener(
          "prompt:optimization:progress",
          handleProgress,
        );
      });
  },
  abortPromptOptimization: (streamId: string): Promise<boolean> =>
    ipcRenderer.invoke("prompt:optimization:abort", streamId),
};
