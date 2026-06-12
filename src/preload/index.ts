import { contextBridge, ipcRenderer } from "electron";

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
  maxContextTokens: number | null;
  maxTokens: number | null;
  streamIdleTimeoutSec: number | null;
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

export type ImportSnowCliApiConfigsResult = {
  importedCount: number;
  configs: ApiConfigRecord[];
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
  importSnowCliApiConfigs: (): Promise<ImportSnowCliApiConfigsResult> =>
    ipcRenderer.invoke("api-configs:import-snow-cli"),
  sum: (a: number, b: number): Promise<number> =>
    ipcRenderer.invoke("native:sum", a, b),
};

contextBridge.exposeInMainWorld("snow", api);

export type SnowApi = typeof api;
