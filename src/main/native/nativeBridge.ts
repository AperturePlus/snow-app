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
      initializeAppStorage: () => {
        throw new Error(
          "Rust native bridge is required to initialize Snow App storage"
        );
      },
      getSystemSettingValue: () => {
        throw new Error(
          "Rust native bridge is required to read system settings"
        );
      },
      setSystemSetting: () => {
        throw new Error(
          "Rust native bridge is required to write system settings"
        );
      },
      listApiConfigs: () => {
        throw new Error("Rust native bridge is required to list API configs");
      },
      upsertApiConfig: () => {
        throw new Error("Rust native bridge is required to write API configs");
      },
      deleteApiConfig: () => {
        throw new Error("Rust native bridge is required to delete API configs");
      },
      listSystemPrompts: () => {
        throw new Error(
          "Rust native bridge is required to list system prompts"
        );
      },
      upsertSystemPrompt: () => {
        throw new Error(
          "Rust native bridge is required to write system prompts"
        );
      },
      deleteSystemPrompt: () => {
        throw new Error(
          "Rust native bridge is required to delete system prompts"
        );
      },
      listCustomHeaderSchemes: () => {
        throw new Error(
          "Rust native bridge is required to list custom header schemes"
        );
      },
      upsertCustomHeaderScheme: () => {
        throw new Error(
          "Rust native bridge is required to write custom header schemes"
        );
      },
      deleteCustomHeaderScheme: () => {
        throw new Error(
          "Rust native bridge is required to delete custom header schemes"
        );
      },
      listWorkspaceDirectories: () => {
        throw new Error(
          "Rust native bridge is required to list workspace directories"
        );
      },
      upsertWorkspaceDirectory: () => {
        throw new Error(
          "Rust native bridge is required to write workspace directories"
        );
      },
      activateWorkspaceDirectory: () => {
        throw new Error(
          "Rust native bridge is required to activate workspace directories"
        );
      },
      reorderWorkspaceDirectories: () => {
        throw new Error(
          "Rust native bridge is required to reorder workspace directories"
        );
      },
      deleteWorkspaceDirectory: () => {
        throw new Error(
          "Rust native bridge is required to delete workspace directories"
        );
      },
      readDirectoryEntries: () => {
        throw new Error(
          "Rust native bridge is required to read directory entries"
        );
      },
      searchFiles: () => {
        throw new Error("Rust native bridge is required to search files");
      },
      listMcpServerConfigs: () => {
        throw new Error(
          "Rust native bridge is required to list MCP server configs"
        );
      },
      upsertMcpServerConfig: () => {
        throw new Error(
          "Rust native bridge is required to write MCP server configs"
        );
      },
      deleteMcpServerConfig: () => {
        throw new Error(
          "Rust native bridge is required to delete MCP server configs"
        );
      },
      listSensitiveCommandConfigs: () => {
        throw new Error(
          "Rust native bridge is required to list sensitive command configs"
        );
      },
      upsertSensitiveCommandConfig: () => {
        throw new Error(
          "Rust native bridge is required to write sensitive command configs"
        );
      },
      deleteSensitiveCommandConfig: () => {
        throw new Error(
          "Rust native bridge is required to delete sensitive command configs"
        );
      },
      listChatConversations: () => {
        throw new Error(
          "Rust native bridge is required to list chat conversations"
        );
      },
      listChatConversationsPaginated: () => {
        throw new Error(
          "Rust native bridge is required to list chat conversations paginated"
        );
      },
      listPinnedConversations: () => {
        throw new Error(
          "Rust native bridge is required to list pinned conversations"
        );
      },
      getChatConversation: () => {
        throw new Error(
          "Rust native bridge is required to get chat conversation"
        );
      },
      updateConversationStatus: () => {
        throw new Error(
          "Rust native bridge is required to update conversation status"
        );
      },
      renameConversation: () => {
        throw new Error(
          "Rust native bridge is required to rename conversation"
        );
      },
      deleteConversation: () => {
        throw new Error(
          "Rust native bridge is required to delete conversation"
        );
      },
      listChatMessages: () => {
        throw new Error("Rust native bridge is required to list chat messages");
      },
      generateConversationSummary: () =>
        Promise.reject(
          new Error(
            "Rust native bridge is required to generate conversation summary"
          )
        ),
      fetchAvailableModels: () => {
        throw new Error(
          "Rust native bridge is required to fetch available models"
        );
      },
      fetchAvailableModelsForConfig: () => {
        throw new Error(
          "Rust native bridge is required to fetch available models"
        );
      },
      createResponseStream: () =>
        Promise.reject(
          new Error("Rust native bridge is required to stream AI responses")
        ),
      abortResponseStream: () => false,
      engineInfo: () => "Rust native bridge is not built yet",
      sum: (a: number, b: number) => a + b,
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
      listMcpTools: () => {
        throw new Error("Rust native bridge is required to list MCP tools");
      },
      callMcpTool: () => {
        throw new Error("Rust native bridge is required to call MCP tools");
      },
    };
  }
};

export const native = loadNativeBridge();
