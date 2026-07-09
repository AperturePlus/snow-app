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
  systemPromptIdsJson: string;
  customHeaderSchemeId: string;
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

export type FileSearchResult = {
  path: string;
  relativePath: string;
  name: string;
  isDirectory: boolean;
  matchedName: boolean;
  lineMatches: Array<{ line: number; text: string }>;
};

export type DirectoryEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
};

export type FileContentResult = {
  content: string;
  isBinary: boolean;
  isImage: boolean;
  isSvg: boolean;
  mimeType: string;
  encoding: string;
  size: number;
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
  forkedFromConversationId: string;
  forkMessageCount: number;
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

export type DetectedTerminal = {
  name: string;
  path: string;
  family: string;
};

export type NativeBridge = {
  initializeAppStorage: () => Promise<AppStorageInfo>;

  getSystemSettingValue: (settingCode: string) => Promise<string | null>;
  setSystemSetting: (
    settingName: string,
    settingCode: string,
    settingValue: string
  ) => Promise<void>;
  listApiConfigs: () => Promise<ApiConfigRecord[]>;
  upsertApiConfig: (config: ApiConfigInput) => Promise<void>;
  deleteApiConfig: (profileName: string) => Promise<void>;
  listSystemPrompts: () => Promise<SystemPromptItemRecord[]>;
  upsertSystemPrompt: (item: SystemPromptItemInput) => Promise<void>;
  deleteSystemPrompt: (promptId: string) => Promise<void>;
  listCustomHeaderSchemes: () => Promise<CustomHeaderSchemeRecord[]>;
  upsertCustomHeaderScheme: (item: CustomHeaderSchemeInput) => Promise<void>;
  deleteCustomHeaderScheme: (schemeId: string) => Promise<void>;
  listWorkspaceDirectories: () => Promise<WorkspaceDirectoryRecord[]>;
  upsertWorkspaceDirectory: (item: WorkspaceDirectoryInput) => Promise<void>;
  activateWorkspaceDirectory: (directoryId: string) => Promise<void>;
  reorderWorkspaceDirectories: (
    items: WorkspaceDirectoryInput[]
  ) => Promise<void>;
  deleteWorkspaceDirectory: (directoryId: string) => Promise<void>;
  readDirectoryEntries: (dirPath: string) => Promise<DirectoryEntry[]>;
  readFileContent: (filePath: string) => Promise<FileContentResult>;
  searchFiles: (rootDir: string, query: string) => Promise<FileSearchResult[]>;
  listMcpServerConfigs: () => Promise<McpServerConfigRecord[]>;
  upsertMcpServerConfig: (item: McpServerConfigInput) => Promise<void>;
  deleteMcpServerConfig: (serverId: string) => Promise<void>;
  listSensitiveCommandConfigs: () => Promise<SensitiveCommandConfigRecord[]>;
  upsertSensitiveCommandConfig: (
    item: SensitiveCommandConfigInput
  ) => Promise<void>;
  deleteSensitiveCommandConfig: (
    commandId: string,
    scope: string
  ) => Promise<void>;
  listChatConversations: (
    directoryId: string
  ) => Promise<ChatConversationRecord[]>;
  listChatConversationsPaginated: (
    directoryId: string,
    limit: number,
    offset: number
  ) => Promise<ChatConversationPage>;
  listPinnedConversations: (
    directoryId: string
  ) => Promise<ChatConversationRecord[]>;
  getChatConversation: (
    conversationId: string
  ) => Promise<ChatConversationRecord | null>;
  updateConversationStatus: (
    conversationId: string,
    status: string
  ) => Promise<void>;
  renameConversation: (conversationId: string, title: string) => Promise<void>;
  deleteConversation: (conversationId: string) => Promise<void>;
  listChatMessages: (conversationId: string) => Promise<ChatMessageRecord[]>;
  forkConversation: (
    sourceConversationId: string,
    upToResponseId: string
  ) => Promise<ChatConversationRecord>;
  generateConversationSummary: (conversationId: string) => Promise<string>;
  fetchAvailableModels: () => Promise<Model[]>;
  fetchAvailableModelsForConfig: (config: ApiModelsConfig) => Promise<Model[]>;
  createResponseStream: (
    request: ResponsesApiRequest,
    onChunk: (chunk: ResponsesApiStreamChunk) => void,
    streamId: string
  ) => Promise<ResponsesApiResult>;
  abortResponseStream: (streamId: string) => boolean;
  listMcpTools: () => Promise<McpToolDefinition[]>;
  callMcpTool: (toolFullName: string, argsJson: string) => Promise<string>;
  engineInfo: () => string;
  sum: (a: number, b: number) => number;
  detectTerminals: () => Promise<DetectedTerminal[]>;
  getGitStatus: (repoPath: string) => Promise<GitStatusResult>;
  getGitBranches: (repoPath: string) => Promise<GitBranch[]>;
  gitStageFiles: (
    repoPath: string,
    filePaths: string[]
  ) => Promise<GitStageResult>;
  gitUnstageFiles: (
    repoPath: string,
    filePaths: string[]
  ) => Promise<GitStageResult>;
  gitStageAll: (repoPath: string) => Promise<GitStageResult>;
  gitUnstageAll: (repoPath: string) => Promise<GitStageResult>;
  gitCommit: (repoPath: string, message: string) => Promise<GitCommitResult>;
  gitPush: (repoPath: string) => Promise<GitPushPullResult>;
  gitPull: (repoPath: string) => Promise<GitPushPullResult>;
  gitCheckout: (
    repoPath: string,
    branchName: string
  ) => Promise<GitCheckoutResult>;
  gitFileDiff: (
    repoPath: string,
    filePath: string,
    staged: boolean
  ) => Promise<GitDiffResult>;
  gitDiscardChanges: (
    repoPath: string,
    filePaths: string[]
  ) => Promise<GitStageResult>;
  startGitWatch: (
    repoPath: string,
    onChange: (repoPath: string) => void
  ) => void;
  stopGitWatch: (repoPath: string) => void;
};
