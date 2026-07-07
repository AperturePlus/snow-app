import { app } from "electron";
import { join } from "node:path";
import type { NativeBridge } from "./types";

export const loadNativeBridge = (): NativeBridge => {
  try {
    const nativeEntry = join(app.getAppPath(), "native", "index.cjs");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(nativeEntry) as NativeBridge;
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
          new Error(
            "Rust native bridge is required to read system settings"
          )
        ),
      setSystemSetting: () =>
        Promise.reject(
          new Error(
            "Rust native bridge is required to write system settings"
          )
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
          new Error(
            "Rust native bridge is required to list system prompts"
          )
        ),
      upsertSystemPrompt: () =>
        Promise.reject(
          new Error(
            "Rust native bridge is required to write system prompts"
          )
        ),
      deleteSystemPrompt: () =>
        Promise.reject(
          new Error(
            "Rust native bridge is required to delete system prompts"
          )
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
          new Error(
            "Rust native bridge is required to read directory entries"
          )
        ),
      searchFiles: () =>
        Promise.reject(
          new Error("Rust native bridge is required to search files")
        ),
      listMcpServerConfigs: () =>
        Promise.reject(
          new Error(
            "Rust native bridge is required to list MCP server configs"
          )
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
          new Error(
            "Rust native bridge is required to list chat conversations"
          )
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
          new Error(
            "Rust native bridge is required to get chat conversation"
          )
        ),
      updateConversationStatus: () =>
        Promise.reject(
          new Error(
            "Rust native bridge is required to update conversation status"
          )
        ),
      renameConversation: () =>
        Promise.reject(
          new Error(
            "Rust native bridge is required to rename conversation"
          )
        ),
      deleteConversation: () =>
        Promise.reject(
          new Error(
            "Rust native bridge is required to delete conversation"
          )
        ),
      listChatMessages: () =>
        Promise.reject(
          new Error("Rust native bridge is required to list chat messages")
        ),
      generateConversationSummary: () =>
        Promise.reject(
          new Error(
            "Rust native bridge is required to generate conversation summary"
          )
        ),
      fetchAvailableModels: () =>
        Promise.reject(
          new Error(
            "Rust native bridge is required to fetch available models"
          )
        ),
      fetchAvailableModelsForConfig: () =>
        Promise.reject(
          new Error(
            "Rust native bridge is required to fetch available models"
          )
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
    };
  }
};

export const native = loadNativeBridge();
