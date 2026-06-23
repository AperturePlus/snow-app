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
  role: "user" | "assistant" | "system" | "developer";
  content: string;
};

export type ResponsesApiRequest = {
  messages: ResponsesApiMessage[];
  model?: string | null;
  conversationId?: string | null;
  previousResponseId?: string | null;
  directoryId?: string | null;
};

export type ResponsesApiResult = {
  id: string;
  conversationId: string;
  content: string;
  thinking: string;
  model: string;
  status: string;
};

export type ResponsesApiStreamChunk = {
  contentDelta: string;
  thinkingDelta: string;
  content: string;
  thinking: string;
};

export type ProxyBrowserSettings = {
  enabled: boolean;
  port: number;
  browserPath: string;
  browserDebugPort: number;
  searchEngine: string;
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

export type CodebaseSettingsRecord = CodebaseSettingsInput & {
  id: string;
  updatedAt: string;
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
    onChunk?: (chunk: ResponsesApiStreamChunk) => void
  ): Promise<ResponsesApiResult> => {
    const streamId = createResponseStreamId();
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
  importSnowCliApiConfigs: (): Promise<ImportSnowCliApiConfigsResult> =>
    ipcRenderer.invoke("api-configs:import-snow-cli"),
  importSnowCliProxyConfig: (): Promise<ProxyBrowserSettings> =>
    ipcRenderer.invoke("proxy-browser-settings:import-snow-cli"),
  getCodebaseSettings: (): Promise<CodebaseSettingsRecord> =>
    ipcRenderer.invoke("codebase-settings:get"),
  upsertCodebaseSettings: (
    settings: CodebaseSettingsInput
  ): Promise<CodebaseSettingsRecord> =>
    ipcRenderer.invoke("codebase-settings:upsert", settings),
  importSnowCliCodebaseSettings: (): Promise<CodebaseSettingsRecord> =>
    ipcRenderer.invoke("codebase-settings:import-snow-cli"),
  selectBrowserExecutable: (dialogTitle?: string): Promise<string | null> =>
    ipcRenderer.invoke(
      "proxy-browser-settings:select-browser-executable",
      dialogTitle
    ),
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
  listChatConversations: (
    directoryId: string
  ): Promise<ChatConversationRecord[]> =>
    ipcRenderer.invoke("chat-conversations:list", directoryId),
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
  writeLog: (level: string, entry: unknown): Promise<void> =>
    ipcRenderer.invoke("debug:write-log", level, entry),
  sum: (a: number, b: number): Promise<number> =>
    ipcRenderer.invoke("native:sum", a, b),
};

contextBridge.exposeInMainWorld("snow", api);

export type SnowApi = typeof api;
