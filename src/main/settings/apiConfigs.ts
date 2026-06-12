import type { ApiConfigInput } from "../native/types";
import type { SnowCliProfile } from "../snowCli/profiles";
import { isRecord, toBoolean, toIntegerOrNull, toText } from "../utils/value";

export const toApiConfigInput = (profile: SnowCliProfile): ApiConfigInput => {
  const snowcfg = isRecord(profile.config.snowcfg)
    ? profile.config.snowcfg
    : {};

  return {
    profileName: profile.name,
    displayName: profile.name,
    isActive: profile.isActive,
    baseUrl: toText(snowcfg.baseUrl, "https://api.openai.com/v1"),
    baseUrlMode: toText(snowcfg.baseUrlMode, "auto"),
    apiKey: toText(snowcfg.apiKey),
    requestMethod: toText(snowcfg.requestMethod, "chat"),
    advancedModel: toText(snowcfg.advancedModel),
    basicModel: toText(snowcfg.basicModel),
    supportsVision: toBoolean(snowcfg.supportsVision, true),
    visionBaseUrl: toText(snowcfg.visionBaseUrl),
    visionBaseUrlMode: toText(snowcfg.visionBaseUrlMode, "auto"),
    visionApiKey: toText(snowcfg.visionApiKey),
    visionRequestMethod: toText(snowcfg.visionRequestMethod, "chat"),
    visionModel: toText(snowcfg.visionModel),
    maxContextTokens: toIntegerOrNull(snowcfg.maxContextTokens),
    maxTokens: toIntegerOrNull(snowcfg.maxTokens),
    streamIdleTimeoutSec: toIntegerOrNull(snowcfg.streamIdleTimeoutSec),
    configJson: JSON.stringify(profile.config),
    source: "snow-cli",
  };
};

export const normalizeApiConfigInput = (value: unknown): ApiConfigInput => {
  if (!isRecord(value)) {
    throw new Error("API config payload must be an object");
  }

  const profileName = toText(value.profileName).trim();

  if (!profileName) {
    throw new Error("Profile name is required");
  }

  const displayName =
    toText(value.displayName, profileName).trim() || profileName;
  const baseUrl =
    toText(value.baseUrl, "https://api.openai.com/v1").trim() ||
    "https://api.openai.com/v1";
  const requestMethod = toText(value.requestMethod, "chat").trim() || "chat";
  const advancedModel = toText(value.advancedModel).trim();
  const basicModel = toText(value.basicModel).trim();
  const supportsVision = toBoolean(value.supportsVision, true);
  const visionBaseUrl = toText(value.visionBaseUrl).trim();
  const visionModel = toText(value.visionModel).trim();
  const source = toText(value.source, "manual").trim() || "manual";
  const visionRequestMethod =
    toText(value.visionRequestMethod, requestMethod).trim() || requestMethod;
  const manualConfig = {
    snowcfg: {
      baseUrl,
      baseUrlMode: toText(value.baseUrlMode, "custom"),
      requestMethod,
      advancedModel,
      basicModel,
      supportsVision,
      visionBaseUrl,
      visionBaseUrlMode: toText(value.visionBaseUrlMode, "auto"),
      visionRequestMethod,
      visionModel,
      maxContextTokens: toIntegerOrNull(value.maxContextTokens) ?? undefined,
      maxTokens: toIntegerOrNull(value.maxTokens) ?? undefined,
      streamIdleTimeoutSec:
        toIntegerOrNull(value.streamIdleTimeoutSec) ?? undefined,
      source,
    },
  };

  return {
    profileName,
    displayName,
    isActive: toBoolean(value.isActive, false),
    baseUrl,
    baseUrlMode: toText(value.baseUrlMode, "custom"),
    apiKey: toText(value.apiKey),
    requestMethod,
    advancedModel,
    basicModel,
    supportsVision,
    visionBaseUrl,
    visionBaseUrlMode: toText(value.visionBaseUrlMode, "auto"),
    visionApiKey: toText(value.visionApiKey),
    visionRequestMethod,
    visionModel,
    maxContextTokens: toIntegerOrNull(value.maxContextTokens) ?? undefined,
    maxTokens: toIntegerOrNull(value.maxTokens) ?? undefined,
    streamIdleTimeoutSec:
      toIntegerOrNull(value.streamIdleTimeoutSec) ?? undefined,
    configJson: toText(value.configJson, JSON.stringify(manualConfig)),
    source,
  };
};
