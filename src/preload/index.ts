import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

export type ApiConfigInput = {
  profileName: string;
  displayName: string;
  isActive: boolean;
  baseUrl: string;
  baseUrlMode: string;
  apiKey: string;
  requestMethod: string;
  advancedModel: string;
  basicModel: string;
  supportsVision: boolean;
  visionBaseUrl: string;
  visionBaseUrlMode: string;
  visionApiKey: string;
  visionRequestMethod: string;
  visionModel: string;
  maxContextTokens?: number | null;
  maxTokens?: number | null;
  streamIdleTimeoutSec?: number | null;
  enableAutoCompress: boolean;
  autoCompressThreshold?: number | null;
  systemPromptIdsJson: string;
  customHeaderSchemeId: string;
  configJson: string;
  source: string;
};

export type ApiConfigRecord = ApiConfigInput & {
  id: string;
  updatedAt: string;
};
export type ImportSnowCliApiConfigsResult = {
  importedCount: number;
  configs: ApiConfigRecord[];
};

export type Model = {
  id: string;
  object: string;
  created: number;
  ownedBy: string;
};

export type ApiModelsConfig = {
  baseUrl: string;
  baseUrlMode: string;
  apiKey: string;
  requestMethod: string;
};
export type ResponsesApiMessage = {
  role: "user" | "assistant" | "system" | "developer" | "tool";
  content: string;
};

export type ResponsesApiRequest = {
  messages: ResponsesApiMessage[];
  model?: string | null;
  conversationId?: string | null;
  previousResponseId?: string | null;
  directoryId?: string | null;
};

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
};

export type ResponsesApiResult = {
  id: string;
  conversationId: string;
  content: string;
  thinking: string;
  model: string;
  status: string;
  toolCallsJson: string;
  tokenUsage: TokenUsage;
};

export type ResponsesApiStreamChunk = {
  contentDelta: string;
  thinkingDelta: string;
  content: string;
  thinking: string;
};

export type McpToolDefinition = {
  name: string;
  description: string;
  inputSchemaJson: string;
};

export type ProxyBrowserSettings = {
  enabled: boolean;
  port: number;
  browserPath: string;
  browserDebugPort: number;
  searchEngine: string;
};

export type TerminalSettings = {
  shellPath: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  lineHeight: number;
  proxy: string;
};

export type DetectedTerminal = {
  name: string;
  path: string;
  family: "powershell" | "cmd" | "posix";
};

export type CodebaseSettingsInput = {
  profileName: string;
  enabled: boolean;
  enableAgentReview: boolean;
  enableReranking: boolean;
  embeddingType: string;
  embeddingModelName: string;
  embeddingBaseUrl: string;
  embeddingApiKey: string;
  embeddingDimensions: number;
  batchMaxLines: number;
  batchConcurrency: number;
  chunkingMaxLinesPerChunk: number;
  chunkingMinLinesPerChunk: number;
  chunkingMinCharsPerChunk: number;
  chunkingOverlapLines: number;
  rerankingModelName: string;
  rerankingBaseUrl: string;
  rerankingApiKey: string;
  rerankingContextLength: number;
  rerankingTopN: number;
  configJson: string;
  source: string;
};

export type SystemPromptItemInput = {
  promptId: string;
  name: string;
  content: string;
  isActive: boolean;
  sortOrder: number;
};

export type SystemPromptItemRecord = SystemPromptItemInput & {
  id: string;
  updatedAt: string;
};

export type CustomHeaderSchemeInput = {
  schemeId: string;
  name: string;
  headersJson: string;
  isActive: boolean;
  sortOrder: number;
};

export type CustomHeaderSchemeRecord = CustomHeaderSchemeInput & {
  id: string;
  updatedAt: string;
};

export type WorkspaceDirectoryKind = "local" | "ssh";

export type WorkspaceDirectoryInput = {
  directoryId: string;
  name: string;
  path: string;
  kind: WorkspaceDirectoryKind;
  isActive: boolean;
  sortOrder: number;
  source: string;
};
export type WorkspaceDirectoryRecord = WorkspaceDirectoryInput & {
  id: string;
  updatedAt: string;
};

export type DirectoryEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
};

export type SshAuthMethod = "password" | "privateKey" | "agent";

export type SshConnectParams = {
  host: string;
  port: number;
  username: string;
  authMethod: SshAuthMethod;
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
};

export type SshDirectoryEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
};

export type SshCredentialRecord = {
  profileKey: string;
  host: string;
  port: number;
  username: string;
  authMethod: SshAuthMethod;
  privateKeyPath?: string;
  encryptedSecret?: string;
};

export type ParsedSshUrl = {
  host: string;
  port: number;
  username: string;
  remotePath: string;
};

export type GitFileStatus = {
  path: string;
  oldPath: string | null;
  indexStatus: string;
  workdirStatus: string;
  status: string;
};

export type GitStatusResult = {
  isRepo: boolean;
  currentBranch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  files: GitFileStatus[];
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
};

export type GitBranch = {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
  remoteName: string | null;
};

export type GitDiffResult = {
  content: string;
  isBinary: boolean;
};

export type GitStageResult = {
  success: boolean;
  message: string;
};

export type GitCommitResult = {
  success: boolean;
  message: string;
  hash: string | null;
};

export type GitPushPullResult = {
  success: boolean;
  message: string;
};

export type GitCheckoutResult = {
  success: boolean;
  message: string;
};

export type FileSearchResult = {
  path: string;
  relativePath: string;
  name: string;
  isDirectory: boolean;
  matchedName: boolean;
  lineMatches: Array<{ line: number; text: string }>;
};

export type McpServerConfigInput = {
  serverId: string;
  scope: string;
  name: string;
  transportType: string;
  url: string;
  command: string;
  argsJson: string;
  envJson: string;
  headersJson: string;
  enabled: boolean;
  timeoutMs?: number;
  sortOrder: number;
  source: string;
};

export type McpServerConfigRecord = Omit<McpServerConfigInput, "timeoutMs"> & {
  id: string;
  timeoutMs: number | null;
  updatedAt: string;
};

export type SensitiveCommandConfigInput = {
  commandId: string;
  scope: string;
  pattern: string;
  description: string;
  enabled: boolean;
  isPreset: boolean;
  sortOrder: number;
  source: string;
};

export type SensitiveCommandConfigRecord = SensitiveCommandConfigInput & {
  id: string;
  updatedAt: string;
};

export type ChatConversationRecord = {
  conversationId: string;
  title: string;
  summary: string;
  lastMessagePreview: string;
  messageCount: number;
  model: string;
  status: string;
  directoryId: string;
  createdAt: string;
  updatedAt: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
};

export type ChatConversationPage = {
  items: ChatConversationRecord[];
  total: number;
};

export type ChatMessageRecord = {
  id: string;
  role: string;
  content: string;
  thinking: string;
  status: string;
  model: string;
  responseId: string;
  toolCallsJson: string;
  createdAt: string;
};

const CHAT_CREATE_RESPONSE_CHUNK_CHANNEL = "chat:create-response:chunk";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const createResponseStreamId = (): string =>
  `response-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const normalizeResponseStreamChunk = (
  value: unknown
): ResponsesApiStreamChunk | null => {
  if (!isRecord(value)) {
    return null;
  }

  return {
    contentDelta:
      typeof value.contentDelta === "string" ? value.contentDelta : "",
    thinkingDelta:
      typeof value.thinkingDelta === "string" ? value.thinkingDelta : "",
    content: typeof value.content === "string" ? value.content : "",
    thinking: typeof value.thinking === "string" ? value.thinking : "",
  };
};

const api = {
  engineInfo: (): Promise<string> => ipcRenderer.invoke("native:engine-info"),
  getSystemSettingValue: (settingCode: string): Promise<string | null> =>
    ipcRenderer.invoke("settings:get-system-setting-value", settingCode),
  setSystemSetting: (
    settingName: string,
    settingCode: string,
    settingValue: string
  ): Promise<void> =>
    ipcRenderer.invoke(
      "settings:set-system-setting",
      settingName,
      settingCode,
      settingValue
    ),
  listApiConfigs: (): Promise<ApiConfigRecord[]> =>
    ipcRenderer.invoke("api-configs:list"),
  upsertApiConfig: (config: ApiConfigInput): Promise<ApiConfigRecord[]> =>
    ipcRenderer.invoke("api-configs:upsert", config),
  deleteApiConfig: (profileName: string): Promise<ApiConfigRecord[]> =>
    ipcRenderer.invoke("api-configs:delete", profileName),
  fetchAvailableModels: (): Promise<Model[]> =>
    ipcRenderer.invoke("api-models:fetch"),
  fetchAvailableModelsForConfig: (config: ApiModelsConfig): Promise<Model[]> =>
    ipcRenderer.invoke("api-models:fetch-for-config", config),
  createResponseStream: (
    request: ResponsesApiRequest,
    onChunk?: (chunk: ResponsesApiStreamChunk) => void,
    onStreamId?: (streamId: string) => void
  ): Promise<ResponsesApiResult> => {
    const streamId = createResponseStreamId();
    onStreamId?.(streamId);
    const handleChunk = (_event: IpcRendererEvent, payload: unknown): void => {
      if (!isRecord(payload) || payload.streamId !== streamId) {
        return;
      }

      const chunk = normalizeResponseStreamChunk(payload.chunk);
      if (chunk) {
        onChunk?.(chunk);
      }
    };

    ipcRenderer.on(CHAT_CREATE_RESPONSE_CHUNK_CHANNEL, handleChunk);

    return ipcRenderer
      .invoke("chat:create-response-stream", request, streamId)
      .finally(() => {
        ipcRenderer.removeListener(
          CHAT_CREATE_RESPONSE_CHUNK_CHANNEL,
          handleChunk
        );
      });
  },
  abortResponseStream: (streamId: string): Promise<boolean> =>
    ipcRenderer.invoke("chat:abort-response-stream", streamId),
  importSnowCliApiConfigs: (): Promise<ImportSnowCliApiConfigsResult> =>
    ipcRenderer.invoke("api-configs:import-snow-cli"),
  importSnowCliProxyConfig: (): Promise<ProxyBrowserSettings> =>
    ipcRenderer.invoke("proxy-browser-settings:import-snow-cli"),
  importSnowCliCodebaseSettings: (): Promise<CodebaseSettingsInput> =>
    ipcRenderer.invoke("codebase-settings:import-snow-cli"),
  selectBrowserExecutable: (dialogTitle?: string): Promise<string | null> =>
    ipcRenderer.invoke(
      "proxy-browser-settings:select-browser-executable",
      dialogTitle
    ),
  detectTerminals: (): Promise<DetectedTerminal[]> =>
    ipcRenderer.invoke("terminal:detect-terminals"),
  selectTerminalExecutable: (dialogTitle?: string): Promise<string | null> =>
    ipcRenderer.invoke("terminal-settings:select-executable", dialogTitle),

  listSystemPrompts: (): Promise<SystemPromptItemRecord[]> =>
    ipcRenderer.invoke("system-prompts:list"),
  upsertSystemPrompt: (item: SystemPromptItemInput): Promise<void> =>
    ipcRenderer.invoke("system-prompts:upsert", item),
  deleteSystemPrompt: (promptId: string): Promise<void> =>
    ipcRenderer.invoke("system-prompts:delete", promptId),
  importSnowCliSystemPromptConfig: (): Promise<SystemPromptItemRecord[]> =>
    ipcRenderer.invoke("system-prompts:import-snow-cli"),
  listCustomHeaderSchemes: (): Promise<CustomHeaderSchemeRecord[]> =>
    ipcRenderer.invoke("custom-header-schemes:list"),
  upsertCustomHeaderScheme: (
    item: CustomHeaderSchemeInput
  ): Promise<CustomHeaderSchemeRecord[]> =>
    ipcRenderer.invoke("custom-header-schemes:upsert", item),
  deleteCustomHeaderScheme: (
    schemeId: string
  ): Promise<CustomHeaderSchemeRecord[]> =>
    ipcRenderer.invoke("custom-header-schemes:delete", schemeId),
  importSnowCliCustomHeadersConfig: (): Promise<CustomHeaderSchemeRecord[]> =>
    ipcRenderer.invoke("custom-header-schemes:import-snow-cli"),
  listWorkspaceDirectories: (): Promise<WorkspaceDirectoryRecord[]> =>
    ipcRenderer.invoke("workspace-directories:list"),
  upsertWorkspaceDirectory: (
    item: WorkspaceDirectoryInput
  ): Promise<WorkspaceDirectoryRecord[]> =>
    ipcRenderer.invoke("workspace-directories:upsert", item),
  activateWorkspaceDirectory: (
    directoryId: string
  ): Promise<WorkspaceDirectoryRecord[]> =>
    ipcRenderer.invoke("workspace-directories:activate", directoryId),
  reorderWorkspaceDirectories: (
    items: WorkspaceDirectoryInput[]
  ): Promise<WorkspaceDirectoryRecord[]> =>
    ipcRenderer.invoke("workspace-directories:reorder", items),
  deleteWorkspaceDirectory: (
    directoryId: string
  ): Promise<WorkspaceDirectoryRecord[]> =>
    ipcRenderer.invoke("workspace-directories:delete", directoryId),
  selectWorkspaceDirectory: (dialogTitle?: string): Promise<string | null> =>
    ipcRenderer.invoke(
      "workspace-directories:select-local-directory",
      dialogTitle
    ),
  readDirectoryEntries: (dirPath: string): Promise<DirectoryEntry[]> =>
    ipcRenderer.invoke("workspace-directories:read-entries", dirPath),
  startDirectoryWatch: (dirPath: string): Promise<void> =>
    ipcRenderer.invoke("workspace-directories:start-watch", dirPath),
  stopDirectoryWatch: (dirPath: string): Promise<void> =>
    ipcRenderer.invoke("workspace-directories:stop-watch", dirPath),
  onDirectoryChanged: (callback: (dirPath: string) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, dirPath: string): void => {
      callback(dirPath);
    };

    ipcRenderer.on("workspace-directories:changed", handler);

    return () => {
      ipcRenderer.removeListener("workspace-directories:changed", handler);
    };
  },
  searchFiles: (dirPath: string, query: string): Promise<FileSearchResult[]> =>
    ipcRenderer.invoke("workspace-directories:search-files", dirPath, query),
  sshConnect: (params: SshConnectParams): Promise<string> =>
    ipcRenderer.invoke("ssh:connect", params),
  sshListDirectory: (
    sessionId: string,
    remotePath: string
  ): Promise<SshDirectoryEntry[]> =>
    ipcRenderer.invoke("ssh:list-directory", sessionId, remotePath),
  sshDisconnect: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke("ssh:disconnect", sessionId),
  sshSaveCredential: (params: {
    host: string;
    port: number;
    username: string;
    authMethod: SshAuthMethod;
    privateKeyPath?: string;
    secret?: string;
  }): Promise<SshCredentialRecord> =>
    ipcRenderer.invoke("ssh:save-credential", params),
  sshGetCredential: (
    host: string,
    port: number,
    username: string
  ): Promise<SshCredentialRecord | null> =>
    ipcRenderer.invoke("ssh:get-credential", host, port, username),
  sshGetDecryptedSecret: (
    host: string,
    port: number,
    username: string
  ): Promise<string | null> =>
    ipcRenderer.invoke("ssh:get-decrypted-secret", host, port, username),
  sshListCredentials: (): Promise<SshCredentialRecord[]> =>
    ipcRenderer.invoke("ssh:list-credentials"),
  sshDeleteCredential: (
    host: string,
    port: number,
    username: string
  ): Promise<void> =>
    ipcRenderer.invoke("ssh:delete-credential", host, port, username),
  sshSelectPrivateKey: (dialogTitle?: string): Promise<string | null> =>
    ipcRenderer.invoke("ssh:select-private-key", dialogTitle),
  sshParseUrl: (sshUrl: string): Promise<ParsedSshUrl> =>
    ipcRenderer.invoke("ssh:parse-url", sshUrl),
  listChatConversations: (
    directoryId: string
  ): Promise<ChatConversationRecord[]> =>
    ipcRenderer.invoke("chat-conversations:list", directoryId),
  listChatConversationsPaginated: (
    directoryId: string,
    limit: number,
    offset: number
  ): Promise<ChatConversationPage> =>
    ipcRenderer.invoke(
      "chat-conversations:list-paginated",
      directoryId,
      limit,
      offset
    ),
  listPinnedConversations: (
    directoryId: string
  ): Promise<ChatConversationRecord[]> =>
    ipcRenderer.invoke("chat-conversations:list-pinned", directoryId),
  getChatConversation: (
    conversationId: string
  ): Promise<ChatConversationRecord | null> =>
    ipcRenderer.invoke("chat-conversations:get", conversationId),
  updateConversationStatus: (
    conversationId: string,
    status: string
  ): Promise<void> =>
    ipcRenderer.invoke(
      "chat-conversations:update-status",
      conversationId,
      status
    ),
  renameConversation: (conversationId: string, title: string): Promise<void> =>
    ipcRenderer.invoke("chat-conversations:rename", conversationId, title),
  deleteConversation: (conversationId: string): Promise<void> =>
    ipcRenderer.invoke("chat-conversations:delete", conversationId),
  listChatMessages: (conversationId: string): Promise<ChatMessageRecord[]> =>
    ipcRenderer.invoke("chat-conversations:list-messages", conversationId),
  generateConversationSummary: (conversationId: string): Promise<string> =>
    ipcRenderer.invoke("chat-conversations:generate-summary", conversationId),
  listMcpServerConfigs: (): Promise<McpServerConfigRecord[]> =>
    ipcRenderer.invoke("mcp-server-configs:list"),
  upsertMcpServerConfig: (
    item: McpServerConfigInput
  ): Promise<McpServerConfigRecord[]> =>
    ipcRenderer.invoke("mcp-server-configs:upsert", item),
  deleteMcpServerConfig: (serverId: string): Promise<McpServerConfigRecord[]> =>
    ipcRenderer.invoke("mcp-server-configs:delete", serverId),
  importSnowCliMcpConfig: (): Promise<McpServerConfigRecord[]> =>
    ipcRenderer.invoke("mcp-server-configs:import-snow-cli"),
  listSensitiveCommandConfigs: (): Promise<SensitiveCommandConfigRecord[]> =>
    ipcRenderer.invoke("sensitive-command-configs:list"),
  upsertSensitiveCommandConfig: (
    item: SensitiveCommandConfigInput
  ): Promise<SensitiveCommandConfigRecord[]> =>
    ipcRenderer.invoke("sensitive-command-configs:upsert", item),
  deleteSensitiveCommandConfig: (
    commandId: string,
    scope: string
  ): Promise<SensitiveCommandConfigRecord[]> =>
    ipcRenderer.invoke("sensitive-command-configs:delete", commandId, scope),
  importSnowCliSensitiveCommandConfig: (): Promise<
    SensitiveCommandConfigRecord[]
  > => ipcRenderer.invoke("sensitive-command-configs:import-snow-cli"),
  listMcpTools: (): Promise<McpToolDefinition[]> =>
    ipcRenderer.invoke("mcp:list-tools"),
  callMcpTool: (toolFullName: string, argsJson: string): Promise<string> =>
    ipcRenderer.invoke("mcp:call-tool", toolFullName, argsJson),
  writeLog: (level: string, entry: unknown): Promise<void> =>
    ipcRenderer.invoke("debug:write-log", level, entry),
  sum: (a: number, b: number): Promise<number> =>
    ipcRenderer.invoke("native:sum", a, b),
  // ===== Git =====
  gitStatus: (repoPath: string): Promise<GitStatusResult> =>
    ipcRenderer.invoke("git:status", repoPath),
  startGitWatch: (repoPath: string): Promise<void> =>
    ipcRenderer.invoke("git:start-watch", repoPath),
  stopGitWatch: (repoPath: string): Promise<void> =>
    ipcRenderer.invoke("git:stop-watch", repoPath),
  onGitStatusChanged: (callback: (repoPath: string) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, repoPath: string): void => {
      callback(repoPath);
    };

    ipcRenderer.on("git:status-changed", handler);

    return () => {
      ipcRenderer.removeListener("git:status-changed", handler);
    };
  },
  gitBranches: (repoPath: string): Promise<GitBranch[]> =>
    ipcRenderer.invoke("git:branches", repoPath),
  gitStage: (repoPath: string, filePaths: string[]): Promise<GitStageResult> =>
    ipcRenderer.invoke("git:stage", repoPath, filePaths),
  gitUnstage: (
    repoPath: string,
    filePaths: string[]
  ): Promise<GitStageResult> =>
    ipcRenderer.invoke("git:unstage", repoPath, filePaths),
  gitStageAll: (repoPath: string): Promise<GitStageResult> =>
    ipcRenderer.invoke("git:stage-all", repoPath),
  gitUnstageAll: (repoPath: string): Promise<GitStageResult> =>
    ipcRenderer.invoke("git:unstage-all", repoPath),
  gitCommit: (repoPath: string, message: string): Promise<GitCommitResult> =>
    ipcRenderer.invoke("git:commit", repoPath, message),
  gitPush: (repoPath: string): Promise<GitPushPullResult> =>
    ipcRenderer.invoke("git:push", repoPath),
  gitPull: (repoPath: string): Promise<GitPushPullResult> =>
    ipcRenderer.invoke("git:pull", repoPath),
  gitCheckout: (
    repoPath: string,
    branchName: string
  ): Promise<GitCheckoutResult> =>
    ipcRenderer.invoke("git:checkout", repoPath, branchName),
  gitFileDiff: (
    repoPath: string,
    filePath: string,
    staged: boolean
  ): Promise<GitDiffResult> =>
    ipcRenderer.invoke("git:file-diff", repoPath, filePath, staged),
  // ===== PTY =====
  ptyCreate: (options: {
    cwd: string;
    cols: number;
    rows: number;
    shellPath?: string;
  }): Promise<string> => ipcRenderer.invoke("pty:create", options),
  ptyWrite: (id: string, data: string): Promise<void> =>
    ipcRenderer.invoke("pty:write", id, data),
  ptyResize: (id: string, cols: number, rows: number): Promise<void> =>
    ipcRenderer.invoke("pty:resize", id, cols, rows),
  ptyKill: (id: string): Promise<void> => ipcRenderer.invoke("pty:kill", id),
  onPtyOutput: (
    callback: (data: { id: string; data: string }) => void
  ): (() => void) => {
    const handler = (
      _event: IpcRendererEvent,
      payload: { id: string; data: string }
    ): void => {
      callback(payload);
    };

    ipcRenderer.on("pty:output", handler);

    return () => {
      ipcRenderer.removeListener("pty:output", handler);
    };
  },
  onPtyExit: (
    callback: (data: { id: string; exitCode: number }) => void
  ): (() => void) => {
    const handler = (
      _event: IpcRendererEvent,
      payload: { id: string; exitCode: number }
    ): void => {
      callback(payload);
    };

    ipcRenderer.on("pty:exit", handler);

    return () => {
      ipcRenderer.removeListener("pty:exit", handler);
    };
  },
  // ===== Window Controls =====
  minimizeWindow: (): Promise<void> => ipcRenderer.invoke("window:minimize"),
  toggleMaximizeWindow: (): Promise<void> =>
    ipcRenderer.invoke("window:maximize-toggle"),
  closeWindow: (): Promise<void> => ipcRenderer.invoke("window:close"),
  isWindowMaximized: (): Promise<boolean> =>
    ipcRenderer.invoke("window:is-maximized"),
  startWindowDrag: (): Promise<void> => ipcRenderer.invoke("window:start-drag"),
  stopWindowDrag: (): Promise<void> => ipcRenderer.invoke("window:stop-drag"),
  writeImageToClipboard: (dataUrl: string): Promise<void> =>
    ipcRenderer.invoke("clipboard:write-image", dataUrl),
  clearBrowserCache: (): Promise<void> =>
    ipcRenderer.invoke("browser:clear-cache"),
  clearBrowserCookies: (): Promise<void> =>
    ipcRenderer.invoke("browser:clear-cookies"),
  onWindowMaximizeStateChanged: (
    callback: (isMaximized: boolean) => void
  ): (() => void) => {
    const handler = (_event: IpcRendererEvent, isMaximized: boolean): void => {
      callback(isMaximized);
    };

    ipcRenderer.on("window:maximize-state-changed", handler);

    return () => {
      ipcRenderer.removeListener("window:maximize-state-changed", handler);
    };
  },
};

contextBridge.exposeInMainWorld("snow", api);

export type SnowApi = typeof api;
