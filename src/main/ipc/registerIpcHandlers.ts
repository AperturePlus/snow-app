import { BrowserWindow, dialog, ipcMain } from "electron";
import type {
  ApiModelsConfig,
  NativeBridge,
  ResponsesApiRequest,
  ResponsesApiStreamChunk,
} from "../native/types";
import { writeLog, type LogEntry, type LogLevel } from "../../utils/snowLogger";
import {
  normalizeApiConfigInput,
  toApiConfigInput,
} from "../settings/apiConfigs";
import {
  normalizeCodebaseSettings,
  persistCodebaseSettings,
  readSnowCliCodebaseSettings,
} from "../settings/codebaseSettings";
import {
  normalizeSystemPromptItem,
  readSnowCliSystemPromptConfig,
} from "../settings/systemPromptSettings";
import {
  normalizeCustomHeaderScheme,
  readSnowCliCustomHeadersConfig,
} from "../settings/customHeadersSettings";
import {
  normalizeMcpServerConfig,
  readSnowCliMcpConfig,
} from "../settings/mcpSettings";
import { readSnowCliProxyConfig } from "../settings/proxyBrowserSettings";
import {
  normalizeSensitiveCommandConfig,
  readSnowCliSensitiveCommandConfig,
} from "../settings/sensitiveCommandSettings";
import {
  normalizeWorkspaceDirectory,
  normalizeWorkspaceDirectoryList,
} from "../settings/workspaceDirectories";
import { readSnowCliProfiles } from "../snowCli/profiles";

const CHAT_CREATE_RESPONSE_CHUNK_CHANNEL = "chat:create-response:chunk";

const normalizeCreateResponseStreamId = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Create response stream ID is required");
  }

  return value.trim();
};

const normalizeResponsesApiRequest = (value: unknown): ResponsesApiRequest => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Responses API request payload must be an object");
  }

  const source = value as Partial<Record<keyof ResponsesApiRequest, unknown>>;
  const rawMessages = Array.isArray(source.messages) ? source.messages : [];
  const messages = rawMessages
    .map((item) => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) {
        return null;
      }

      const message = item as Partial<
        Record<keyof ResponsesApiRequest["messages"][number], unknown>
      >;
      const role =
        message.role === "assistant" ||
        message.role === "system" ||
        message.role === "developer"
          ? message.role
          : "user";
      const content =
        typeof message.content === "string" ? message.content : "";

      return {
        role,
        content,
      };
    })
    .filter((message): message is ResponsesApiRequest["messages"][number] =>
      Boolean(message && message.content.trim())
    );

  if (messages.length === 0) {
    throw new Error(
      "Responses API request requires at least one non-empty message"
    );
  }

  return {
    messages,
    model: typeof source.model === "string" ? source.model : undefined,
    conversationId:
      typeof source.conversationId === "string"
        ? source.conversationId
        : undefined,
    previousResponseId:
      typeof source.previousResponseId === "string"
        ? source.previousResponseId
        : undefined,
  };
};

export const registerIpcHandlers = (native: NativeBridge): void => {
  ipcMain.handle("native:engine-info", () => native.engineInfo());
  ipcMain.handle(
    "settings:get-system-setting-value",
    (_event, settingCode: string) => native.getSystemSettingValue(settingCode)
  );
  ipcMain.handle(
    "settings:set-system-setting",
    (_event, settingName: string, settingCode: string, settingValue: string) =>
      native.setSystemSetting(settingName, settingCode, settingValue)
  );
  ipcMain.handle("api-configs:list", () => native.listApiConfigs());
  ipcMain.handle("api-configs:upsert", (_event, config: unknown) => {
    native.upsertApiConfig(normalizeApiConfigInput(config));
    return native.listApiConfigs();
  });
  ipcMain.handle("api-configs:delete", (_event, profileName: unknown) => {
    if (typeof profileName !== "string" || !profileName.trim()) {
      throw new Error("Profile name is required");
    }

    native.deleteApiConfig(profileName.trim());
    return native.listApiConfigs();
  });
  ipcMain.handle("api-configs:import-snow-cli", () => {
    const profiles = readSnowCliProfiles();

    for (const profile of profiles) {
      native.upsertApiConfig(toApiConfigInput(profile));
    }

    return {
      importedCount: profiles.length,
      configs: native.listApiConfigs(),
    };
  });
  ipcMain.handle("api-models:fetch", async () => {
    try {
      const models = native.fetchAvailableModels();
      return models;
    } catch (error) {
      throw error;
    }
  });
  ipcMain.handle(
    "api-models:fetch-for-config",
    async (_event, config: unknown) => {
      if (
        typeof config !== "object" ||
        config === null ||
        Array.isArray(config)
      ) {
        throw new Error("API model config is required");
      }

      const source = config as Partial<Record<keyof ApiModelsConfig, unknown>>;
      const normalizedConfig: ApiModelsConfig = {
        baseUrl: typeof source.baseUrl === "string" ? source.baseUrl : "",
        baseUrlMode:
          typeof source.baseUrlMode === "string" ? source.baseUrlMode : "auto",
        apiKey: typeof source.apiKey === "string" ? source.apiKey : "",
        requestMethod:
          typeof source.requestMethod === "string"
            ? source.requestMethod
            : "chat",
      };

      return native.fetchAvailableModelsForConfig(normalizedConfig);
    }
  );
  ipcMain.handle(
    "chat:create-response-stream",
    async (event, request: unknown, streamId: unknown) => {
      const normalizedRequest = normalizeResponsesApiRequest(request);
      const normalizedStreamId = normalizeCreateResponseStreamId(streamId);

      return await native.createResponseStream(
        normalizedRequest,
        (chunk: ResponsesApiStreamChunk) => {
          if (event.sender.isDestroyed()) {
            return;
          }

          event.sender.send(CHAT_CREATE_RESPONSE_CHUNK_CHANNEL, {
            streamId: normalizedStreamId,
            chunk,
          });
        }
      );
    }
  );

  ipcMain.handle("proxy-browser-settings:import-snow-cli", () =>
    readSnowCliProxyConfig(native)
  );

  ipcMain.handle("codebase-settings:get", () => native.getCodebaseSettings());
  ipcMain.handle("codebase-settings:upsert", (_event, settings: unknown) =>
    persistCodebaseSettings(native, normalizeCodebaseSettings(settings))
  );
  ipcMain.handle("codebase-settings:import-snow-cli", () =>
    readSnowCliCodebaseSettings(native)
  );
  ipcMain.handle("system-prompts:list", () => native.listSystemPrompts());
  ipcMain.handle("system-prompts:upsert", (_event, item: unknown) => {
    native.upsertSystemPrompt(normalizeSystemPromptItem(item));
    return native.listSystemPrompts();
  });
  ipcMain.handle("system-prompts:delete", (_event, promptId: unknown) => {
    if (typeof promptId !== "string" || !promptId.trim()) {
      throw new Error("Prompt ID is required");
    }
    native.deleteSystemPrompt(promptId.trim());
    return native.listSystemPrompts();
  });
  ipcMain.handle("system-prompts:import-snow-cli", () =>
    readSnowCliSystemPromptConfig(native)
  );
  ipcMain.handle("custom-header-schemes:list", () =>
    native.listCustomHeaderSchemes()
  );
  ipcMain.handle("custom-header-schemes:upsert", (_event, item: unknown) => {
    native.upsertCustomHeaderScheme(normalizeCustomHeaderScheme(item));
    return native.listCustomHeaderSchemes();
  });
  ipcMain.handle(
    "custom-header-schemes:delete",
    (_event, schemeId: unknown) => {
      if (typeof schemeId !== "string" || !schemeId.trim()) {
        throw new Error("Custom header scheme ID is required");
      }
      native.deleteCustomHeaderScheme(schemeId.trim());
      return native.listCustomHeaderSchemes();
    }
  );
  ipcMain.handle("custom-header-schemes:import-snow-cli", () =>
    readSnowCliCustomHeadersConfig(native)
  );
  ipcMain.handle("mcp-server-configs:list", () =>
    native.listMcpServerConfigs()
  );
  ipcMain.handle("mcp-server-configs:upsert", (_event, item: unknown) => {
    native.upsertMcpServerConfig(normalizeMcpServerConfig(item));
    return native.listMcpServerConfigs();
  });
  ipcMain.handle("mcp-server-configs:delete", (_event, serverId: unknown) => {
    if (typeof serverId !== "string" || !serverId.trim()) {
      throw new Error("MCP server ID is required");
    }
    native.deleteMcpServerConfig(serverId.trim());
    return native.listMcpServerConfigs();
  });
  ipcMain.handle("mcp-server-configs:import-snow-cli", () =>
    readSnowCliMcpConfig(native)
  );
  ipcMain.handle("sensitive-command-configs:list", () =>
    native.listSensitiveCommandConfigs()
  );
  ipcMain.handle(
    "sensitive-command-configs:upsert",
    (_event, item: unknown) => {
      native.upsertSensitiveCommandConfig(
        normalizeSensitiveCommandConfig(item)
      );
      return native.listSensitiveCommandConfigs();
    }
  );
  ipcMain.handle(
    "sensitive-command-configs:delete",
    (_event, commandId: unknown, scope: unknown) => {
      if (typeof commandId !== "string" || !commandId.trim()) {
        throw new Error("Sensitive command ID is required");
      }

      const normalizedScope = scope === "project" ? "project" : "global";
      native.deleteSensitiveCommandConfig(commandId.trim(), normalizedScope);
      return native.listSensitiveCommandConfigs();
    }
  );
  ipcMain.handle("sensitive-command-configs:import-snow-cli", () =>
    readSnowCliSensitiveCommandConfig(native)
  );
  ipcMain.handle("workspace-directories:list", () =>
    native.listWorkspaceDirectories()
  );
  ipcMain.handle("workspace-directories:upsert", (_event, item: unknown) => {
    const existingCount = native.listWorkspaceDirectories().length;
    native.upsertWorkspaceDirectory(
      normalizeWorkspaceDirectory(item, existingCount)
    );
    return native.listWorkspaceDirectories();
  });
  ipcMain.handle(
    "workspace-directories:activate",
    (_event, directoryId: unknown) => {
      if (typeof directoryId !== "string" || !directoryId.trim()) {
        throw new Error("Workspace directory ID is required");
      }

      native.activateWorkspaceDirectory(directoryId.trim());
      return native.listWorkspaceDirectories();
    }
  );
  ipcMain.handle("workspace-directories:reorder", (_event, items: unknown) => {
    const existingCount = native.listWorkspaceDirectories().length;
    const directories = normalizeWorkspaceDirectoryList(items, existingCount);

    if (typeof native.reorderWorkspaceDirectories === "function") {
      native.reorderWorkspaceDirectories(directories);
    } else {
      for (const directory of directories) {
        native.upsertWorkspaceDirectory(directory);
      }
    }

    return native.listWorkspaceDirectories();
  });
  ipcMain.handle(
    "workspace-directories:delete",
    (_event, directoryId: unknown) => {
      if (typeof directoryId !== "string" || !directoryId.trim()) {
        throw new Error("Workspace directory ID is required");
      }

      native.deleteWorkspaceDirectory(directoryId.trim());
      return native.listWorkspaceDirectories();
    }
  );
  ipcMain.handle(
    "workspace-directories:select-local-directory",
    async (event, dialogTitle: unknown) => {
      const browserWindow = BrowserWindow.fromWebContents(event.sender);
      const title =
        typeof dialogTitle === "string" && dialogTitle.trim()
          ? dialogTitle.trim()
          : "Select workspace directory";
      const options: Electron.OpenDialogOptions = {
        title,
        properties: ["openDirectory"],
      };
      const result = browserWindow
        ? await dialog.showOpenDialog(browserWindow, options)
        : await dialog.showOpenDialog(options);

      return result.canceled ? null : result.filePaths[0] ?? null;
    }
  );
  ipcMain.handle(
    "proxy-browser-settings:select-browser-executable",
    async (event, dialogTitle: unknown) => {
      const browserWindow = BrowserWindow.fromWebContents(event.sender);
      const title =
        typeof dialogTitle === "string" && dialogTitle.trim()
          ? dialogTitle.trim()
          : "Select browser executable";
      const options: Electron.OpenDialogOptions = {
        title,
        properties: ["openFile"],
        filters:
          process.platform === "win32"
            ? [
                { name: "Applications", extensions: ["exe"] },
                { name: "All files", extensions: ["*"] },
              ]
            : [{ name: "All files", extensions: ["*"] }],
      };
      const result = browserWindow
        ? await dialog.showOpenDialog(browserWindow, options)
        : await dialog.showOpenDialog(options);

      return result.canceled ? null : result.filePaths[0] ?? null;
    }
  );
  ipcMain.handle("native:sum", (_event, a: number, b: number) =>
    native.sum(a, b)
  );
  ipcMain.handle(
    "debug:write-log",
    (_event, level: unknown, entry: unknown) => {
      writeLog(level as LogLevel, entry as LogEntry);
    }
  );
};
