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

export type SensitiveCommandConfigInput = {
  commandId: string;
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

export type ProjectSensitiveCommandConfigInput = {
  commandId: string;
  pattern: string;
  description: string;
  enabled: boolean;
  sortOrder: number;
};

export type ProjectSensitiveCommandConfigRecord =
  ProjectSensitiveCommandConfigInput & {
    inherited: boolean;
    globalEnabled: boolean;
    isPreset: boolean;
    source: string;
  };
