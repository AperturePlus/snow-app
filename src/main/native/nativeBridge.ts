import { app } from "electron";
import { join } from "node:path";
import type { NativeBridge } from "./types";
import { storageReady } from "../app/storageReady";

/**
 * Wraps a native binding in a Proxy that awaits `storageReady` before
 * invoking any method. This lets the window appear instantly while the
 * Rust SQLite database initialises in the background — IPC handlers
 * that call native methods will simply pause until storage is ready,
 * without each handler needing its own guard.
 */
const wrapWithStorageGate = <T extends object>(binding: T): T => {
  return new Proxy(binding, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") {
        return value;
      }
      return (...args: unknown[]) =>
        storageReady.then(() => value.apply(target, args));
    },
  }) as T;
};

let rawBinding: NativeBridge | null = null;

export const loadNativeBridge = (): NativeBridge => {
  try {
    const nativeEntry = join(app.getAppPath(), "native", "index.cjs");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const binding = require(nativeEntry);
    rawBinding = binding as NativeBridge;
    return wrapWithStorageGate(binding) as NativeBridge;
  } catch (error) {
    console.warn(
      "Native Rust bridge is unavailable, using development fallback.",
      error
    );

    return {
      initializeAppStorage: () =>
        Promise.reject(
          new Error(
            "Rust native bridge is required to initialize Snow App storage"
          )
        ),
      getSystemSettingValue: () =>
        Promise.reject(
          new Error("Rust native bridge is required to read system settings")
        ),
      setSystemSetting: () =>
        Promise.reject(
          new Error("Rust native bridge is required to write system settings")
        ),
      listApiConfigs: () =>
        Promise.reject(
          new Error("Rust native bridge is required to list API configs")
        ),
      upsertApiConfig: () =>
        Promise.reject(
          new Error("Rust native bridge is required to write API configs")
        ),
      deleteApiConfig: () =>
        Promise.reject(
          new Error("Rust native bridge is required to delete API configs")
        ),
      listSystemPrompts: () =>
        Promise.reject(
          new Error("Rust native bridge is required to list system prompts")
        ),
      upsertSystemPrompt: () =>
        Promise.reject(
          new Error("Rust native bridge is required to write system prompts")
        ),
      deleteSystemPrompt: () =>
        Promise.reject(
          new Error("Rust native bridge is required to delete system prompts")
        ),
      listCustomHeaderSchemes: () =>
        Promise.reject(
          new Error(
            "Rust native bridge is required to list custom header schemes"
          )
        ),
      upsertCustomHeaderScheme: () =>
        Promise.reject(
          new Error(
            "Rust native bridge is required to write custom header schemes"
          )
        ),
      deleteCustomHeaderScheme: () =>
        Promise.reject(
          new Error(
            "Rust native bridge is required to delete custom header schemes"
          )
        ),
      listWorkspaceDirectories: () =>
        Promise.reject(
          new Error(
            "Rust native bridge is required to list workspace directories"
          )
        ),
      upsertWorkspaceDirectory: () =>
        Promise.reject(
          new Error(
            "Rust native bridge is required to write workspace directories"
          )
        ),
      activateWorkspaceDirectory: () =>
        Promise.reject(
          new Error(
            "Rust native bridge is required to activate workspace directories"
          )
        ),
      reorderWorkspaceDirectories: () =>
        Promise.reject(
          new Error(
            "Rust native bridge is required to reorder workspace directories"
          )
        ),
      deleteWorkspaceDirectory: () =>
        Promise.reject(
          new Error(
            "Rust native bridge is required to delete workspace directories"
          )
        ),
      readDirectoryEntries: () =>
        Promise.reject(
          new Error("Rust native bridge is required to read directory entries")
        ),
      readFileContent: () =>
        Promise.reject(
          new Error("Rust native bridge is required to read file content")
        ),
      searchFiles: () =>
        Promise.reject(
          new Error("Rust native bridge is required to search files")
        ),
      listMcpServerConfigs: () =>
        Promise.reject(
          new Error("Rust native bridge is required to list MCP server configs")
        ),
      upsertMcpServerConfig: () =>
        Promise.reject(
          new Error(
            "Rust native bridge is required to write MCP server configs"
          )
        ),
      deleteMcpServerConfig: () =>
        Promise.reject(
          new Error(
            "Rust native bridge is required to delete MCP server configs"
          )
        ),
      listSensitiveCommandConfigs: () =>
        Promise.reject(
          new Error(
            "Rust native bridge is required to list sensitive command configs"
          )
        ),
      upsertSensitiveCommandConfig: () =>
        Promise.reject(
          new Error(
            "Rust native bridge is required to write sensitive command configs"
          )
        ),
      deleteSensitiveCommandConfig: () =>
        Promise.reject(
          new Error(
            "Rust native bridge is required to delete sensitive command configs"
          )
        ),
      listChatConversations: () =>
        Promise.reject(
          new Error("Rust native bridge is required to list chat conversations")
        ),
      listChatConversationsPaginated: () =>
        Promise.reject(
          new Error(
            "Rust native bridge is required to list chat conversations paginated"
          )
        ),
      listPinnedConversations: () =>
        Promise.reject(
          new Error(
            "Rust native bridge is required to list pinned conversations"
          )
        ),
      getChatConversation: () =>
        Promise.reject(
          new Error("Rust native bridge is required to get chat conversation")
        ),
      updateConversationStatus: () =>
        Promise.reject(
          new Error(
            "Rust native bridge is required to update conversation status"
          )
        ),
      renameConversation: () =>
        Promise.reject(
          new Error("Rust native bridge is required to rename conversation")
        ),
      deleteConversation: () =>
        Promise.reject(
          new Error("Rust native bridge is required to delete conversation")
        ),
      listChatMessages: () =>
        Promise.reject(
          new Error("Rust native bridge is required to list chat messages")
        ),
      forkConversation: () =>
        Promise.reject(
          new Error("Rust native bridge is required to fork conversation")
        ),
      generateConversationSummary: () =>
        Promise.reject(
          new Error(
            "Rust native bridge is required to generate conversation summary"
          )
        ),
      fetchAvailableModels: () =>
        Promise.reject(
          new Error("Rust native bridge is required to fetch available models")
        ),
      fetchAvailableModelsForConfig: () =>
        Promise.reject(
          new Error("Rust native bridge is required to fetch available models")
        ),
      createResponseStream: () =>
        Promise.reject(
          new Error("Rust native bridge is required to stream AI responses")
        ),
      abortResponseStream: () => false,
      engineInfo: () => "Rust native bridge is not built yet",
      sum: (a: number, b: number) => a + b,
      detectTerminals: () =>
        Promise.reject(
          new Error("Rust native bridge is required to detect terminals")
        ),
      getGitStatus: () => {
        throw new Error("Rust native bridge is required for git status");
      },
      getGitBranches: () => {
        throw new Error("Rust native bridge is required for git branches");
      },
      gitStageFiles: () => {
        throw new Error("Rust native bridge is required for git stage");
      },
      gitUnstageFiles: () => {
        throw new Error("Rust native bridge is required for git unstage");
      },
      gitStageAll: () => {
        throw new Error("Rust native bridge is required for git stage all");
      },
      gitUnstageAll: () => {
        throw new Error("Rust native bridge is required for git unstage all");
      },
      gitCommit: () => {
        throw new Error("Rust native bridge is required for git commit");
      },
      gitPush: () => {
        throw new Error("Rust native bridge is required for git push");
      },
      gitPull: () => {
        throw new Error("Rust native bridge is required for git pull");
      },
      gitCheckout: () => {
        throw new Error("Rust native bridge is required for git checkout");
      },
      gitFileDiff: () => {
        throw new Error("Rust native bridge is required for git file diff");
      },
      gitDiscardChanges: () => {
        throw new Error("Rust native bridge is required for git discard");
      },
      startGitWatch: () => {
        throw new Error("Rust native bridge is required for git watch");
      },
      stopGitWatch: () => {
        throw new Error("Rust native bridge is required to stop git watch");
      },
      listMcpTools: () =>
        Promise.reject(
          new Error("Rust native bridge is required to list MCP tools")
        ),
      callMcpTool: () =>
        Promise.reject(
          new Error("Rust native bridge is required to call MCP tools")
        ),
      createCheckpoint: () =>
        Promise.reject(
          new Error("Rust native bridge is required to create checkpoint")
        ),
      restoreCheckpoint: () =>
        Promise.reject(
          new Error("Rust native bridge is required to restore checkpoint")
        ),
      deleteCheckpoint: () =>
        Promise.reject(
          new Error("Rust native bridge is required to delete checkpoint")
        ),
      listCheckpointChanges: () =>
        Promise.reject(
          new Error("Rust native bridge is required to list checkpoint changes")
        ),
      listCheckpointDiffs: () =>
        Promise.reject(
          new Error("Rust native bridge is required to list checkpoint diffs")
        ),
      truncateConversationFromResponse: () =>
        Promise.reject(
          new Error("Rust native bridge is required to truncate conversation")
        ),
    };
  }
};

let actualNative: NativeBridge | null = null;

/**
 * Lazily loads the native binding on first access. This defers the
 * expensive require() of the ~12 MB Rust .node file until the first
 * method call, so module loading and window creation are not blocked.
 */
const ensureNativeLoaded = (): NativeBridge => {
  if (!actualNative) {
    actualNative = loadNativeBridge();
  }
  return actualNative;
};

/**
 * Lazy Proxy: defers .node file loading until first property access.
 * The inner Proxy from wrapWithStorageGate still gates on
 * storageReady for individual method calls.
 */
export const native = new Proxy({} as NativeBridge, {
  get(_target, prop) {
    const actual = ensureNativeLoaded();
    const value = (actual as Record<string | symbol, unknown>)[prop];
    return typeof value === "function" ? value.bind(actual) : value;
  },
}) as NativeBridge;

/**
 * Returns the raw (un-proxied) native binding. Used by
 * `initializeApplicationServices` to bootstrap storage without
 * deadlocking on the `storageReady` gate that the Proxy enforces.
 */
export const getRawNative = (): NativeBridge => {
  ensureNativeLoaded();
  return rawBinding ?? native;
};
