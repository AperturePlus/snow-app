import {
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
  session,
} from "electron";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
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
import { readSnowCliCodebaseSettings } from "../settings/codebaseSettings";
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
import { startDirectoryWatch, stopDirectoryWatch } from "../utils/fsWatcher";
import { registerPtyHandlers } from "../pty/registerPtyHandlers";

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
        message.role === "developer" ||
        message.role === "tool"
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
    directoryId:
      typeof source.directoryId === "string" ? source.directoryId : undefined,
  };
};

// ===== File search support =====

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  "dist",
  "build",
  ".next",
  ".nuxt",
  "out",
  "coverage",
  ".cache",
  ".turbo",
  ".vercel",
]);

const MAX_FILE_SIZE_BYTES = 512 * 1024; // 512 KB
const MAX_RESULTS = 200;
const CONTENT_PREVIEW_LINES = 3;
const CONTENT_PREVIEW_CHARS = 200;

type SearchResult = {
  path: string;
  relativePath: string;
  name: string;
  isDirectory: boolean;
  matchedName: boolean;
  lineMatches: Array<{ line: number; text: string }>;
};

const isTextFile = (fileName: string): boolean => {
  const binaryExtensions = new Set([
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".bmp",
    ".ico",
    ".webp",
    ".tiff",
    ".svg",
    ".pdf",
    ".zip",
    ".gz",
    ".tar",
    ".rar",
    ".7z",
    ".mp3",
    ".mp4",
    ".avi",
    ".mov",
    ".wav",
    ".flac",
    ".ogg",
    ".exe",
    ".dll",
    ".so",
    ".dylib",
    ".bin",
    ".dat",
    ".db",
    ".sqlite",
    ".class",
    ".jar",
    ".war",
    ".wasm",
    ".ttf",
    ".otf",
    ".woff",
    ".woff2",
    ".eot",
    ".psd",
    ".ai",
    ".sketch",
    ".xd",
    ".proto",
  ]);
  const lowerName = fileName.toLowerCase();
  for (const ext of binaryExtensions) {
    if (lowerName.endsWith(ext)) {
      return false;
    }
  }
  return true;
};

const searchInDirectory = async (
  rootDir: string,
  currentDir: string,
  queryLower: string,
  results: SearchResult[],
  maxDepth: number,
  currentDepth: number
): Promise<void> => {
  if (results.length >= MAX_RESULTS || currentDepth > maxDepth) {
    return;
  }

  let entries: string[];
  try {
    entries = await readdir(currentDir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (results.length >= MAX_RESULTS) {
      return;
    }

    // Skip hidden files and skip dirs
    if (entry.startsWith(".") || SKIP_DIRS.has(entry)) {
      continue;
    }

    const fullPath = join(currentDir, entry);
    let entryStat;
    try {
      entryStat = await stat(fullPath);
    } catch {
      continue;
    }

    if (entryStat.isDirectory()) {
      const dirNameLower = entry.toLowerCase();
      if (dirNameLower.includes(queryLower)) {
        results.push({
          path: fullPath,
          relativePath: relative(rootDir, fullPath),
          name: entry,
          isDirectory: true,
          matchedName: true,
          lineMatches: [],
        });
      }
      await searchInDirectory(
        rootDir,
        fullPath,
        queryLower,
        results,
        maxDepth,
        currentDepth + 1
      );
    } else if (entryStat.isFile()) {
      const nameLower = entry.toLowerCase();
      const matchedName = nameLower.includes(queryLower);
      let lineMatches: Array<{ line: number; text: string }> = [];

      if (
        !matchedName &&
        isTextFile(entry) &&
        entryStat.size <= MAX_FILE_SIZE_BYTES
      ) {
        try {
          const content = await readFile(fullPath, "utf-8");
          const lines = content.split("\n");
          for (
            let i = 0;
            i < lines.length && lineMatches.length < CONTENT_PREVIEW_LINES;
            i++
          ) {
            if (lines[i].toLowerCase().includes(queryLower)) {
              const trimmed = lines[i].trim();
              lineMatches.push({
                line: i + 1,
                text:
                  trimmed.length > CONTENT_PREVIEW_CHARS
                    ? trimmed.slice(0, CONTENT_PREVIEW_CHARS) + "..."
                    : trimmed,
              });
            }
          }
        } catch {
          // Skip unreadable file
        }
      }

      if (matchedName || lineMatches.length > 0) {
        results.push({
          path: fullPath,
          relativePath: relative(rootDir, fullPath),
          name: entry,
          isDirectory: false,
          matchedName,
          lineMatches,
        });
      }
    }
  }
};

export const registerIpcHandlers = (native: NativeBridge): void => {
  registerPtyHandlers();

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
        },
        normalizedStreamId
      );
    }
  );

  ipcMain.handle("chat:abort-response-stream", (_event, streamId: unknown) => {
    const normalizedStreamId = normalizeCreateResponseStreamId(streamId);
    return native.abortResponseStream(normalizedStreamId);
  });

  ipcMain.handle("proxy-browser-settings:import-snow-cli", () =>
    readSnowCliProxyConfig(native)
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
  ipcMain.handle("chat-conversations:list", (_event, directoryId: unknown) => {
    if (typeof directoryId !== "string" || !directoryId.trim()) {
      throw new Error("Directory ID is required to list chat conversations");
    }

    return native.listChatConversations(directoryId.trim());
  });
  ipcMain.handle(
    "chat-conversations:list-paginated",
    (_event, directoryId: unknown, limit: unknown, offset: unknown) => {
      if (typeof directoryId !== "string" || !directoryId.trim()) {
        throw new Error("Directory ID is required to list chat conversations");
      }

      const safeLimit =
        typeof limit === "number" && limit > 0 ? Math.floor(limit) : 20;
      const safeOffset =
        typeof offset === "number" && offset > 0 ? Math.floor(offset) : 0;

      return native.listChatConversationsPaginated(
        directoryId.trim(),
        safeLimit,
        safeOffset
      );
    }
  );
  ipcMain.handle(
    "chat-conversations:list-pinned",
    (_event, directoryId: unknown) => {
      if (typeof directoryId !== "string" || !directoryId.trim()) {
        throw new Error(
          "Directory ID is required to list pinned conversations"
        );
      }

      return native.listPinnedConversations(directoryId.trim());
    }
  );
  ipcMain.handle(
    "chat-conversations:get",
    (_event, conversationId: unknown) => {
      if (typeof conversationId !== "string" || !conversationId.trim()) {
        throw new Error("Conversation ID is required to get conversation");
      }
      return native.getChatConversation(conversationId.trim());
    }
  );
  ipcMain.handle(
    "chat-conversations:generate-summary",
    async (_event, conversationId: unknown) => {
      if (typeof conversationId !== "string" || !conversationId.trim()) {
        throw new Error("Conversation ID is required to generate summary");
      }
      return native.generateConversationSummary(conversationId.trim());
    }
  );
  ipcMain.handle(
    "chat-conversations:list-messages",
    (_event, conversationId: unknown) => {
      if (typeof conversationId !== "string" || !conversationId.trim()) {
        throw new Error("Conversation ID is required to list chat messages");
      }

      return native.listChatMessages(conversationId.trim());
    }
  );
  ipcMain.handle(
    "chat-conversations:update-status",
    (_event, conversationId: unknown, status: unknown) => {
      if (typeof conversationId !== "string" || !conversationId.trim()) {
        throw new Error("Conversation ID is required to update status");
      }
      if (typeof status !== "string" || !status.trim()) {
        throw new Error("Status is required to update conversation status");
      }

      native.updateConversationStatus(conversationId.trim(), status.trim());
    }
  );
  ipcMain.handle(
    "chat-conversations:rename",
    (_event, conversationId: unknown, title: unknown) => {
      if (typeof conversationId !== "string" || !conversationId.trim()) {
        throw new Error("Conversation ID is required to rename");
      }
      if (typeof title !== "string" || !title.trim()) {
        throw new Error("Title is required to rename conversation");
      }

      native.renameConversation(conversationId.trim(), title.trim());
    }
  );
  ipcMain.handle(
    "chat-conversations:delete",
    (_event, conversationId: unknown) => {
      if (typeof conversationId !== "string" || !conversationId.trim()) {
        throw new Error("Conversation ID is required to delete");
      }

      native.deleteConversation(conversationId.trim());
    }
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
  ipcMain.handle(
    "terminal-settings:select-executable",
    async (event, dialogTitle: unknown) => {
      const browserWindow = BrowserWindow.fromWebContents(event.sender);
      const title =
        typeof dialogTitle === "string" && dialogTitle.trim()
          ? dialogTitle.trim()
          : "Select terminal executable";
      const options: Electron.OpenDialogOptions = {
        title,
        properties: ["openFile"],
        filters:
          process.platform === "win32"
            ? [
                { name: "Applications", extensions: ["exe", "bat", "cmd"] },
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
  ipcMain.handle("terminal:detect-terminals", () => native.detectTerminals());
  ipcMain.handle(
    "debug:write-log",
    (_event, level: unknown, entry: unknown) => {
      writeLog(level as LogLevel, entry as LogEntry);
    }
  );
  ipcMain.handle("mcp:list-tools", () => native.listMcpTools());
  ipcMain.handle(
    "mcp:call-tool",
    (_event, toolFullName: unknown, argsJson: unknown) => {
      if (typeof toolFullName !== "string" || !toolFullName.trim()) {
        throw new Error("Tool full name is required");
      }
      if (typeof argsJson !== "string") {
        throw new Error("Arguments JSON string is required");
      }
      return native.callMcpTool(toolFullName.trim(), argsJson);
    }
  );

  ipcMain.handle(
    "workspace-directories:read-entries",
    (_event, dirPath: unknown) => {
      if (typeof dirPath !== "string" || !dirPath.trim()) {
        throw new Error("Directory path is required");
      }

      return native.readDirectoryEntries(dirPath.trim());
    }
  );

  ipcMain.handle(
    "workspace-directories:start-watch",
    (_event, dirPath: unknown) => {
      if (typeof dirPath !== "string" || !dirPath.trim()) {
        throw new Error("Directory path is required");
      }

      startDirectoryWatch(dirPath.trim());
    }
  );

  ipcMain.handle(
    "workspace-directories:stop-watch",
    (_event, dirPath: unknown) => {
      if (typeof dirPath !== "string" || !dirPath.trim()) {
        throw new Error("Directory path is required");
      }

      stopDirectoryWatch(dirPath.trim());
    }
  );

  ipcMain.handle(
    "workspace-directories:search-files",
    async (_event, dirPath: unknown, query: unknown) => {
      if (typeof dirPath !== "string" || !dirPath.trim()) {
        throw new Error("Directory path is required");
      }
      if (typeof query !== "string" || !query.trim()) {
        return [];
      }

      const results: SearchResult[] = [];
      await searchInDirectory(
        dirPath.trim(),
        dirPath.trim(),
        query.trim().toLowerCase(),
        results,
        15,
        0
      );
      return results;
    }
  );

  // ===== Git file watcher handlers =====
  ipcMain.handle("git:start-watch", (event, repoPath: unknown) => {
    if (typeof repoPath !== "string" || !repoPath.trim()) {
      throw new Error("Repository path is required");
    }
    const trimmed = repoPath.trim();
    native.startGitWatch(trimmed, (changedRepoPath: string) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send("git:status-changed", changedRepoPath);
      }
    });
  });

  ipcMain.handle("git:stop-watch", (_event, repoPath: unknown) => {
    if (typeof repoPath !== "string" || !repoPath.trim()) {
      throw new Error("Repository path is required");
    }
    native.stopGitWatch(repoPath.trim());
  });

  // ===== Git handlers =====
  ipcMain.handle("git:status", async (_event, repoPath: unknown) => {
    if (typeof repoPath !== "string" || !repoPath.trim()) {
      throw new Error("Repository path is required");
    }
    return native.getGitStatus(repoPath.trim());
  });

  ipcMain.handle("git:branches", async (_event, repoPath: unknown) => {
    if (typeof repoPath !== "string" || !repoPath.trim()) {
      throw new Error("Repository path is required");
    }
    return native.getGitBranches(repoPath.trim());
  });

  ipcMain.handle(
    "git:stage",
    async (_event, repoPath: unknown, filePaths: unknown) => {
      if (typeof repoPath !== "string" || !repoPath.trim()) {
        throw new Error("Repository path is required");
      }
      const paths = Array.isArray(filePaths)
        ? filePaths.filter((f): f is string => typeof f === "string")
        : [];
      return native.gitStageFiles(repoPath.trim(), paths);
    }
  );

  ipcMain.handle(
    "git:unstage",
    async (_event, repoPath: unknown, filePaths: unknown) => {
      if (typeof repoPath !== "string" || !repoPath.trim()) {
        throw new Error("Repository path is required");
      }
      const paths = Array.isArray(filePaths)
        ? filePaths.filter((f): f is string => typeof f === "string")
        : [];
      return native.gitUnstageFiles(repoPath.trim(), paths);
    }
  );

  ipcMain.handle("git:stage-all", async (_event, repoPath: unknown) => {
    if (typeof repoPath !== "string" || !repoPath.trim()) {
      throw new Error("Repository path is required");
    }
    return native.gitStageAll(repoPath.trim());
  });

  ipcMain.handle("git:unstage-all", async (_event, repoPath: unknown) => {
    if (typeof repoPath !== "string" || !repoPath.trim()) {
      throw new Error("Repository path is required");
    }
    return native.gitUnstageAll(repoPath.trim());
  });

  ipcMain.handle(
    "git:commit",
    async (_event, repoPath: unknown, message: unknown) => {
      if (typeof repoPath !== "string" || !repoPath.trim()) {
        throw new Error("Repository path is required");
      }
      if (typeof message !== "string" || !message.trim()) {
        throw new Error("Commit message is required");
      }
      return native.gitCommit(repoPath.trim(), message);
    }
  );

  ipcMain.handle("git:push", async (_event, repoPath: unknown) => {
    if (typeof repoPath !== "string" || !repoPath.trim()) {
      throw new Error("Repository path is required");
    }
    return native.gitPush(repoPath.trim());
  });

  ipcMain.handle("git:pull", async (_event, repoPath: unknown) => {
    if (typeof repoPath !== "string" || !repoPath.trim()) {
      throw new Error("Repository path is required");
    }
    return native.gitPull(repoPath.trim());
  });

  ipcMain.handle(
    "git:checkout",
    async (_event, repoPath: unknown, branchName: unknown) => {
      if (typeof repoPath !== "string" || !repoPath.trim()) {
        throw new Error("Repository path is required");
      }
      if (typeof branchName !== "string" || !branchName.trim()) {
        throw new Error("Branch name is required");
      }
      return native.gitCheckout(repoPath.trim(), branchName.trim());
    }
  );

  ipcMain.handle(
    "git:file-diff",
    async (_event, repoPath: unknown, filePath: unknown, staged: unknown) => {
      if (typeof repoPath !== "string" || !repoPath.trim()) {
        throw new Error("Repository path is required");
      }
      if (typeof filePath !== "string" || !filePath.trim()) {
        throw new Error("File path is required");
      }
      return native.gitFileDiff(
        repoPath.trim(),
        filePath.trim(),
        staged === true
      );
    }
  );

  // ===== Window Controls (Windows 自定义标题栏) =====
  ipcMain.handle("window:minimize", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.handle("window:maximize-toggle", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      return;
    }
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  });

  ipcMain.handle("window:close", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.handle("window:is-maximized", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win ? win.isMaximized() : false;
  });

  // ===== Clipboard (write image) =====
  ipcMain.handle("clipboard:write-image", (_event, dataUrl: unknown) => {
    if (typeof dataUrl !== "string" || !dataUrl.trim()) {
      throw new Error("Image data URL is required");
    }

    const image = nativeImage.createFromDataURL(dataUrl);
    if (image.isEmpty()) {
      throw new Error("Failed to create image from data URL");
    }

    clipboard.writeImage(image);
  });

  // ===== Browser (embedded webview) =====
  ipcMain.handle("browser:clear-cache", async () => {
    await session.defaultSession.clearCache();
  });

  ipcMain.handle("browser:clear-cookies", async () => {
    await session.defaultSession.clearStorageData({ storages: ["cookies"] });
  });
};
