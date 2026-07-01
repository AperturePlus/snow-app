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
export type ResponsesApiMessage = {
  role: "user" | "assistant" | "system" | "developer" | "tool";
  content: string;
};

export type ResponsesApiRequest = {
  messages: ResponsesApiMessage[];
  model?: string;
  conversationId?: string;
  previousResponseId?: string;
  directoryId?: string;
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
  listChatConversations: (directoryId: string) => ChatConversationRecord[];
  listChatConversationsPaginated: (
    directoryId: string,
    limit: number,
    offset: number
  ) => ChatConversationPage;
  listPinnedConversations: (directoryId: string) => ChatConversationRecord[];
  getChatConversation: (
    conversationId: string
  ) => ChatConversationRecord | null;
  updateConversationStatus: (conversationId: string, status: string) => void;
  renameConversation: (conversationId: string, title: string) => void;
  deleteConversation: (conversationId: string) => void;
  listChatMessages: (conversationId: string) => ChatMessageRecord[];
  generateConversationSummary: (conversationId: string) => Promise<string>;
  fetchAvailableModels: () => Model[];
  fetchAvailableModelsForConfig: (config: ApiModelsConfig) => Model[];
  createResponseStream: (
    request: ResponsesApiRequest,
    onChunk: (chunk: ResponsesApiStreamChunk) => void,
    streamId: string
  ) => Promise<ResponsesApiResult>;
  abortResponseStream: (streamId: string) => boolean;
  listMcpTools: () => McpToolDefinition[];
  callMcpTool: (toolFullName: string, argsJson: string) => string;
  engineInfo: () => string;
  sum: (a: number, b: number) => number;
};
