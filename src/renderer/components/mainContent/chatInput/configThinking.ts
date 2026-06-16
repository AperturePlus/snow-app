import type { ApiConfigRecord } from "../../../../preload";
import { DEFAULT_THINKING_VALUE, THINKING_OPTIONS_BY_METHOD } from "./constants";
import type { RequestMethod, ThinkingOption } from "./types";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const normalizeRequestMethod = (value: unknown): RequestMethod => {
  if (value === "responses" || value === "gemini" || value === "anthropic") {
    return value;
  }

  return "chat";
};

const parseConfigJson = (configJson: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(configJson);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const readNestedString = (
  source: Record<string, unknown>,
  key: string
): string | undefined => {
  const value = source[key];
  return typeof value === "string" ? value : undefined;
};

const readNestedBoolean = (
  source: Record<string, unknown>,
  key: string
): boolean | undefined => {
  const value = source[key];
  return typeof value === "boolean" ? value : undefined;
};

export const isOptionValue = (
  options: ThinkingOption[],
  value: string | undefined
): value is string =>
  typeof value === "string" && options.some((option) => option.value === value);

const resolveThinkingValue = (
  options: ThinkingOption[],
  thinkingConfig: Record<string, unknown>,
  valueKey: string
): string => {
  if (readNestedBoolean(thinkingConfig, "enabled") === false) {
    return "none";
  }

  const configuredValue = readNestedString(thinkingConfig, valueKey);
  return isOptionValue(options, configuredValue)
    ? configuredValue
    : DEFAULT_THINKING_VALUE;
};

export const getThinkingValueFromConfig = (config: ApiConfigRecord): string => {
  const parsedConfig = parseConfigJson(config.configJson);
  const snowcfg = isRecord(parsedConfig.snowcfg) ? parsedConfig.snowcfg : {};
  const requestMethod = normalizeRequestMethod(
    config.requestMethod || snowcfg.requestMethod
  );
  const options = THINKING_OPTIONS_BY_METHOD[requestMethod];

  if (requestMethod === "anthropic") {
    const thinking = isRecord(snowcfg.thinking) ? snowcfg.thinking : {};
    return resolveThinkingValue(options, thinking, "effort");
  }

  if (requestMethod === "gemini") {
    const geminiThinking = isRecord(snowcfg.geminiThinking)
      ? snowcfg.geminiThinking
      : {};
    return resolveThinkingValue(options, geminiThinking, "thinkingLevel");
  }

  if (requestMethod === "responses") {
    const responsesReasoning = isRecord(snowcfg.responsesReasoning)
      ? snowcfg.responsesReasoning
      : {};
    return resolveThinkingValue(options, responsesReasoning, "effort");
  }

  const chatThinking = isRecord(snowcfg.chatThinking) ? snowcfg.chatThinking : {};
  return resolveThinkingValue(options, chatThinking, "reasoning_effort");
};

const buildConfigJsonWithThinking = (
  config: ApiConfigRecord,
  thinkingValue: string
): string => {
  const parsedConfig = parseConfigJson(config.configJson);
  const snowcfg = {
    ...(isRecord(parsedConfig.snowcfg) ? parsedConfig.snowcfg : {}),
  };
  const requestMethod = normalizeRequestMethod(
    config.requestMethod || snowcfg.requestMethod
  );
  const isThinkingEnabled = thinkingValue !== "none";

  snowcfg.requestMethod = config.requestMethod || requestMethod;

  if (requestMethod === "anthropic") {
    snowcfg.thinking = {
      type: "adaptive",
      enabled: isThinkingEnabled,
      effort: thinkingValue,
    };
  } else if (requestMethod === "gemini") {
    snowcfg.geminiThinking = {
      enabled: isThinkingEnabled,
      thinkingLevel: thinkingValue,
    };
  } else if (requestMethod === "responses") {
    snowcfg.responsesReasoning = {
      enabled: isThinkingEnabled,
      effort: thinkingValue,
    };
  } else {
    snowcfg.chatThinking = {
      enabled: isThinkingEnabled,
      reasoning_effort: thinkingValue,
    };
  }

  return JSON.stringify({
    ...parsedConfig,
    snowcfg,
  });
};

export const toConfigUpdatePayload = (
  config: ApiConfigRecord,
  thinkingValue: string
): ApiConfigRecord => ({
  ...config,
  apiKey: "",
  visionApiKey: "",
  visionBaseUrlMode: config.visionBaseUrlMode || "auto",
  configJson: buildConfigJsonWithThinking(config, thinkingValue),
});
