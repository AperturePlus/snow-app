import { ipcMain, type WebContents } from "electron";
import { randomUUID } from "node:crypto";
import type { NativeBridge, ResponsesApiStreamChunk } from "../../native/types";
import type { PromptOptimizationRequest } from "../../../preload/types/promptOptimization";
import { storageReady } from "../../app/storageReady";
import { safeSend } from "../../utils/safeSend";
import {
  createPromptContextHost,
  validateCodebaseOptions,
  contextString,
} from "./promptContextHost";
import { sanitizePromptOptimizationResult } from "./promptContextResult";

type OptimizationStream = {
  nativeId: string;
  cancelled: boolean;
  prepared: boolean;
  enhanced: boolean;
  wakeCancellation: () => void;
};

const validateRequest = (value: unknown): PromptOptimizationRequest => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid optimization request");
  const input = value as Record<string, unknown>;
  const allowed = [
    "streamId",
    "draft",
    "conversationId",
    "apiProfile",
    "model",
    "contextRounds",
    "includeContext",
    "optimizationInstructions",
    "bindingHandle",
    "codebaseContext",
    "contextHandle",
    "selectedSourceIds",
  ];
  if (Object.keys(input).some((key) => !allowed.includes(key)))
    throw new Error("Unknown optimization field");
  if (
    typeof input.streamId !== "string" ||
    !input.streamId.trim() ||
    input.streamId !== input.streamId.trim() ||
    input.streamId.length > 128
  ) {
    throw new Error("Invalid prompt optimization stream ID");
  }
  if (
    typeof input.draft !== "string" ||
    !input.draft.trim() ||
    Array.from(input.draft).length > 20000
  ) {
    throw new Error("Draft must contain 1–20000 characters");
  }
  const request: PromptOptimizationRequest = {
    streamId: input.streamId,
    draft: input.draft,
  };
  for (const key of ["conversationId", "apiProfile", "model"] as const) {
    if (input[key] !== undefined) {
      if (
        typeof input[key] !== "string" ||
        input[key].length > 512 ||
        /[\x00-\x1f]/.test(input[key])
      )
        throw new Error(`Invalid ${key}`);
      request[key] = input[key].trim() || undefined;
    }
  }
  if (input.optimizationInstructions !== undefined) {
    if (
      typeof input.optimizationInstructions !== "string" ||
      Array.from(input.optimizationInstructions).length > 8000
    ) {
      throw new Error(
        "Optimization instructions must be a string of at most 8000 characters",
      );
    }
    request.optimizationInstructions =
      input.optimizationInstructions.trim() || undefined;
  }
  if (input.includeContext !== undefined) {
    if (typeof input.includeContext !== "boolean")
      throw new Error("Invalid includeContext");
    request.includeContext = input.includeContext;
  }
  if (input.contextRounds !== undefined) {
    if (
      typeof input.contextRounds !== "number" ||
      !Number.isInteger(input.contextRounds) ||
      input.contextRounds < 0
    )
      throw new Error("Invalid contextRounds");
    request.contextRounds = Math.min(10, input.contextRounds);
  }
  request.codebaseContext = validateCodebaseOptions(input.codebaseContext);
  const id = (value: unknown, optional = false): string | undefined => {
    const text = contextString(value, optional);
    if (text !== undefined && !/^[a-zA-Z0-9_.:-]{1,200}$/.test(text))
      throw new Error("Invalid context identifier");
    return text;
  };
  request.bindingHandle = id(input.bindingHandle, true);
  request.contextHandle = id(input.contextHandle, true);
  if (input.selectedSourceIds !== undefined) {
    if (
      !Array.isArray(input.selectedSourceIds) ||
      input.selectedSourceIds.length > 16 ||
      !request.contextHandle
    )
      throw new Error("Invalid source selection");
    request.selectedSourceIds = [
      ...new Set(input.selectedSourceIds.map((value) => id(value)!)),
    ];
  }
  if (
    request.contextHandle &&
    (!request.codebaseContext || request.codebaseContext.mode === "off")
  )
    throw new Error("Source review options changed");
  if (
    (request.contextHandle ||
      request.selectedSourceIds ||
      (request.codebaseContext && request.codebaseContext.mode !== "off")) &&
    !request.bindingHandle
  )
    throw new Error("Project context binding required");
  return request;
};

export const registerPromptOptimizationHandlers = (
  native: NativeBridge,
): void => {
  // Ownership is the sender object + public stream ID; native sees only an
  // unpredictable per-call ID, so no renderer can cancel another sender.
  const owners = new Map<WebContents, Map<string, OptimizationStream>>();
  const cancel = (state: OptimizationStream): void => {
    state.cancelled = true;
    state.wakeCancellation();
    if (state.prepared) native.abortPromptOptimization(state.nativeId);
  };
  const contextHost = createPromptContextHost(native, (sender) => {
    for (const stream of owners.get(sender)?.values() ?? [])
      if (stream.enhanced) cancel(stream);
  });
  ipcMain.handle("prompt:optimization:abort", (event, streamId: unknown) => {
    if (typeof streamId !== "string") return false;
    const state = owners.get(event.sender)?.get(streamId);
    if (!state || state.cancelled) return false;
    cancel(state);
    return true;
  });
  ipcMain.handle("prompt:optimization:run", async (event, value: unknown) => {
    const request = validateRequest(value);
    const sender = event.sender;
    if (sender.isDestroyed())
      throw new Error("Optimization sender is unavailable");
    let streams = owners.get(sender);
    if (!streams) {
      streams = new Map();
      owners.set(sender, streams);
    }
    if (streams.has(request.streamId))
      throw new Error("Prompt optimization stream is already running");
    if (streams.size >= 4)
      throw new Error("Too many active prompt optimizations");
    let wakeCancellation: () => void = () => {};
    const cancellation = new Promise<void>((resolve) => {
      wakeCancellation = resolve;
    });
    const state: OptimizationStream = {
      nativeId: randomUUID(),
      cancelled: false,
      prepared: false,
      enhanced:
        !!request.contextHandle ||
        !!(request.codebaseContext && request.codebaseContext.mode !== "off"),
      wakeCancellation,
    };
    streams.set(request.streamId, state);
    const onDestroyed = (): void => cancel(state);
    const onNavigating = (
      _event: unknown,
      _url: string,
      isInPlace: boolean,
      isMainFrame: boolean,
    ): void => {
      if (isMainFrame && !isInPlace) cancel(state);
    };
    sender.once("destroyed", onDestroyed);
    sender.on("did-start-navigation", onNavigating);
    try {
      // Cancel even while storage startup is pending; Promise.race installs
      // rejection handlers on both branches and lets finally release ownership.
      await Promise.race([storageReady, cancellation]);
      if (state.cancelled || sender.isDestroyed())
        throw new Error("Prompt optimization cancelled");
      // Synchronous reservation avoids abort-before-native-async-start races.
      if (!native.preparePromptOptimization(state.nativeId))
        throw new Error("Optimization stream unavailable");
      state.prepared = true;
      const { bindingHandle, codebaseContext, ...baseline } = request;
      const enhanced = codebaseContext && codebaseContext.mode !== "off";
      const binding =
        enhanced || request.contextHandle || bindingHandle
          ? await contextHost.requireBinding(sender, bindingHandle)
          : undefined;
      if (request.contextHandle && binding)
        contextHost.requireSelection(sender, request.contextHandle, binding);
      if (state.enhanced && !contextHost.capability())
        throw new Error("Project context unavailable");
      if (state.cancelled) throw new Error("Prompt optimization cancelled");
      const result = await native.optimizePrompt(
        {
          ...baseline,
          streamId: state.nativeId,
          projectContextJson: enhanced
            ? JSON.stringify(codebaseContext)
            : undefined,
          projectBindingJson: binding?.json,
        },
        (chunk: ResponsesApiStreamChunk) => {
          if (
            streams.get(request.streamId) === state &&
            !state.cancelled &&
            !sender.isDestroyed() &&
            chunk.contentDelta
          ) {
            safeSend(sender, "prompt:optimization:chunk", {
              streamId: request.streamId,
              delta: chunk.contentDelta,
            });
          }
        },
        (phase: string) => {
          if (
            !state.cancelled &&
            !sender.isDestroyed() &&
            /^[a-z_]{1,64}$/.test(phase)
          )
            safeSend(sender, "prompt:optimization:progress", {
              streamId: request.streamId,
              phase,
            });
        },
      );
      if (state.cancelled) throw new Error("Prompt optimization cancelled");
      const output = sanitizePromptOptimizationResult(result);
      if (output.contextHandle && binding)
        contextHost.rememberSources(sender, output.contextHandle, binding);
      return output;
    } catch {
      // Provider errors can echo request bodies or credentials. Never log them
      // or forward them across IPC, even when request logging is enabled.
      throw new Error(
        state.cancelled
          ? "Prompt optimization cancelled"
          : "Prompt optimization failed; check API configuration or retry",
      );
    } finally {
      if (state.prepared) native.abortPromptOptimization(state.nativeId);
      sender.removeListener("destroyed", onDestroyed);
      sender.removeListener("did-start-navigation", onNavigating);
      streams.delete(request.streamId);
      if (streams.size === 0) owners.delete(sender);
    }
  });
};
