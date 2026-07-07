import type { ApiConfigInput } from "../../../../preload";
import {
  DEFAULT_API_BASE_URL,
  DEFAULT_REQUEST_METHOD,
} from "./apiSettingsConstants";
import {
  DEFAULT_AUTO_COMPRESS_THRESHOLD_PERCENT,
  calculateAutoCompressThresholdTokens,
  normalizeAutoCompressThresholdPercent,
} from "./autoCompressThreshold";
import type { ApiConfigFormData } from "./types";

export const emptyApiConfigForm = (
  index: number,
  active: boolean
): ApiConfigFormData => ({
  profileName: `manual-${index}`,
  displayName: "",
  baseUrl: DEFAULT_API_BASE_URL,
  baseUrlMode: "auto",
  apiKey: "",
  requestMethod: DEFAULT_REQUEST_METHOD,
  advancedModel: "",
  basicModel: "",
  isActive: active,
  supportsVision: true,
  visionBaseUrl: "",
  visionApiKey: "",
  visionRequestMethod: DEFAULT_REQUEST_METHOD,
  visionModel: "",
  maxContextTokens: "",
  maxTokens: "",
  streamIdleTimeoutSec: "",
  enableAutoCompress: true,
  autoCompressThreshold: String(DEFAULT_AUTO_COMPRESS_THRESHOLD_PERCENT),
  systemPromptIdsJson: "",
  customHeaderSchemeId: "",
});

export const parseOptionalInteger = (value: string): number | null => {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
};

export function toApiConfigPayload(
  data: ApiConfigFormData,
  isActive: boolean,
  configCount: number
): ApiConfigInput {
  const profileName = data.profileName.trim();
  const displayName = data.displayName.trim() || profileName;
  const baseUrl = data.baseUrl.trim() || DEFAULT_API_BASE_URL;
  const requestMethod = data.requestMethod.trim() || DEFAULT_REQUEST_METHOD;
  const advancedModel = data.advancedModel.trim();
  const basicModel = data.basicModel.trim();
  const visionRequestMethod = data.visionRequestMethod.trim() || requestMethod;
  const autoCompressThresholdPercent = normalizeAutoCompressThresholdPercent(
    data.autoCompressThreshold
  );
  const autoCompressThresholdTokens = calculateAutoCompressThresholdTokens(
    data.maxContextTokens,
    autoCompressThresholdPercent
  );
  const configJson = JSON.stringify({
    snowcfg: {
      baseUrl,
      baseUrlMode: data.baseUrlMode,
      requestMethod,
      advancedModel,
      basicModel,
      supportsVision: data.supportsVision,
      maxContextTokens:
        parseOptionalInteger(data.maxContextTokens) ?? undefined,
      maxTokens: parseOptionalInteger(data.maxTokens) ?? undefined,
      streamIdleTimeoutSec:
        parseOptionalInteger(data.streamIdleTimeoutSec) ?? undefined,
      enableAutoCompress: data.enableAutoCompress,
      autoCompressThresholdPercent,
      autoCompressThreshold: autoCompressThresholdTokens ?? undefined,
    },
  });

  return {
    profileName,
    displayName,
    isActive: isActive || configCount === 0,
    baseUrl,
    baseUrlMode: data.baseUrlMode || "auto",
    apiKey: data.apiKey,
    requestMethod,
    advancedModel,
    basicModel,
    supportsVision: data.supportsVision,
    visionBaseUrl: data.visionBaseUrl.trim(),
    visionBaseUrlMode: "auto",
    visionApiKey: data.visionApiKey,
    visionRequestMethod,
    visionModel: data.visionModel.trim(),
    maxContextTokens: parseOptionalInteger(data.maxContextTokens),
    maxTokens: parseOptionalInteger(data.maxTokens),
    streamIdleTimeoutSec: parseOptionalInteger(data.streamIdleTimeoutSec),
    enableAutoCompress: data.enableAutoCompress,
    autoCompressThreshold: autoCompressThresholdTokens,
    systemPromptIdsJson: data.systemPromptIdsJson,
    customHeaderSchemeId: data.customHeaderSchemeId,
    configJson,
    source: "manual",
  };
}
