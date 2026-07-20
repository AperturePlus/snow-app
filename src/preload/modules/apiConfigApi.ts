import { ipcRenderer, type IpcRendererEvent } from "electron";
import type {
  ApiConfigInput,
  ApiConfigRecord,
  ApiModelsConfig,
  CodebaseSettingsInput,
  DetectedTerminal,
  ImportSnowCliApiConfigsResult,
  Model,
  ProxyBrowserSettings,
  ResponsesApiRequest,
  ResponsesApiResult,
  ResponsesApiStreamChunk,
} from "../types";

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
    retrying: typeof value.retrying === "boolean" ? value.retrying : false,
    retryAttempt:
      typeof value.retryAttempt === "number" ? value.retryAttempt : null,
    retryError: typeof value.retryError === "string" ? value.retryError : null,
    streamTokenCount:
      typeof value.streamTokenCount === "number" ? value.streamTokenCount : 0,
  };
};

export const apiConfigApi = {
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
  getYoloMode: (): Promise<boolean> =>
    ipcRenderer.invoke("settings:get-yolo-mode"),
  setYoloMode: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke("settings:set-yolo-mode", enabled),
  getPlanMode: (): Promise<boolean> =>
    ipcRenderer.invoke("settings:get-plan-mode"),
  setPlanMode: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke("settings:set-plan-mode", enabled),
  listToolApprovalProjectApprovedTools: (
    projectId: string
  ): Promise<string[]> =>
    ipcRenderer.invoke("permissions:list-tool-approvals", projectId),
  setToolApprovalProjectToolApproved: (
    projectId: string,
    toolName: string,
    approved: boolean
  ): Promise<void> =>
    ipcRenderer.invoke(
      "permissions:set-tool-approval",
      projectId,
      toolName,
      approved
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
};
