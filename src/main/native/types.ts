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
  maxContextTokens?: number | null;
  maxTokens?: number | null;
  streamIdleTimeoutSec?: number | null;
  configJson: string;
  source: string;
};

export type ApiConfigRecord = Omit<
  ApiConfigInput,
  "visionBaseUrlMode" | "configJson"
> & {
  id: number;
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
  id: number;
  updatedAt: string;
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
  engineInfo: () => string;
  sum: (a: number, b: number) => number;
};
