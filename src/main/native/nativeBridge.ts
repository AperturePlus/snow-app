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
      getCodebaseSettings: () => {
        throw new Error(
          "Rust native bridge is required to read codebase settings"
        );
      },
      upsertCodebaseSettings: () => {
        throw new Error(
          "Rust native bridge is required to write codebase settings"
        );
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
      engineInfo: () => "Rust native bridge is not built yet",
      sum: (a: number, b: number) => a + b,
    };
  }
};

export const native = loadNativeBridge();
