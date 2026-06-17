export type AppStorageInfo = {
  directoryPath: string;
  databasePath: string;
};

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
  maxContextTokens?: number;
  maxTokens?: number;
  streamIdleTimeoutSec?: number;
  enableAutoCompress: boolean;
  autoCompressThreshold?: number;
  configJson: string;
  source: string;
};

export type ApiConfigRecord = ApiConfigInput & {
  id: string;
  updatedAt: string;
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
  model?: string;
  conversationId?: string;
  previousResponseId?: string;
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

export type NativeBridge = {
  initializeAppStorage: () => AppStorageInfo;

  getSystemSettingValue: (settingCode: string) => string | null;
  setSystemSetting: (
    settingName: string,
    settingCode: string,
    settingValue: string
  ) => void;
  listApiConfigs: () => ApiConfigRecord[];
  upsertApiConfig: (config: ApiConfigInput) => void;
  deleteApiConfig: (profileName: string) => void;
  getCodebaseSettings: () => CodebaseSettingsRecord;
  upsertCodebaseSettings: (settings: CodebaseSettingsInput) => void;
  listSystemPrompts: () => SystemPromptItemRecord[];
  upsertSystemPrompt: (item: SystemPromptItemInput) => void;
  deleteSystemPrompt: (promptId: string) => void;
  listCustomHeaderSchemes: () => CustomHeaderSchemeRecord[];
  upsertCustomHeaderScheme: (item: CustomHeaderSchemeInput) => void;
  deleteCustomHeaderScheme: (schemeId: string) => void;
  listWorkspaceDirectories: () => WorkspaceDirectoryRecord[];
  upsertWorkspaceDirectory: (item: WorkspaceDirectoryInput) => void;
  activateWorkspaceDirectory: (directoryId: string) => void;
  reorderWorkspaceDirectories: (items: WorkspaceDirectoryInput[]) => void;
  deleteWorkspaceDirectory: (directoryId: string) => void;
  listMcpServerConfigs: () => McpServerConfigRecord[];
  upsertMcpServerConfig: (item: McpServerConfigInput) => void;
  deleteMcpServerConfig: (serverId: string) => void;
  listSensitiveCommandConfigs: () => SensitiveCommandConfigRecord[];
  upsertSensitiveCommandConfig: (item: SensitiveCommandConfigInput) => void;
  deleteSensitiveCommandConfig: (commandId: string, scope: string) => void;
  fetchAvailableModels: () => Model[];
  fetchAvailableModelsForConfig: (config: ApiModelsConfig) => Model[];
  createResponseStream: (
    request: ResponsesApiRequest,
    onChunk: (chunk: ResponsesApiStreamChunk) => void
  ) => ResponsesApiResult;
  engineInfo: () => string;
  sum: (a: number, b: number) => number;
};
