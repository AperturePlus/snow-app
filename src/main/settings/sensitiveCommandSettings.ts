import { existsSync } from "node:fs";
import type {
  NativeBridge,
  SensitiveCommandConfigInput,
  SensitiveCommandConfigRecord,
} from "../native/types";
import {
  SNOW_CLI_GLOBAL_SETTINGS_FILE,
  SNOW_CLI_PROJECT_SETTINGS_FILE,
} from "../snowCli/paths";
import { readJsonFile } from "../utils/jsonFile";
import { isRecord, toBoolean, toText } from "../utils/value";

const SENSITIVE_COMMAND_SOURCE_SNOW_CLI = "snow-cli";
const SENSITIVE_COMMAND_SOURCE_MANUAL = "manual";
const DEFAULT_SCOPE = "global";

type SensitiveCommandScope = "global" | "project";

type SnowCliSensitiveCommand = {
  id: string;
  pattern: string;
  description: string;
  enabled: boolean;
  isPreset: boolean;
};

type SnowCliSensitiveCommandConfig = {
  scope: SensitiveCommandScope;
  commands: SnowCliSensitiveCommand[];
  exists: boolean;
};

const normalizeScope = (value: unknown): SensitiveCommandScope =>
  value === "project" ? "project" : "global";

const toCommandId = (pattern: string): string =>
  `custom-${Date.now()}-${pattern
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)}`;

const normalizeSnowCliCommand = (
  value: unknown,
  fallbackIndex: number
): SnowCliSensitiveCommand | null => {
  if (!isRecord(value)) {
    return null;
  }

  const pattern = toText(value.pattern).trim();
  if (!pattern) {
    return null;
  }

  return {
    id: toText(value.id).trim() || toCommandId(`${pattern}-${fallbackIndex}`),
    pattern,
    description: toText(value.description).trim(),
    enabled: toBoolean(value.enabled, true),
    isPreset: toBoolean(value.isPreset, false),
  };
};

const readConfigByScope = (
  scope: SensitiveCommandScope,
  filePath: string
): SnowCliSensitiveCommandConfig => {
  if (!existsSync(filePath)) {
    return { scope, commands: [], exists: false };
  }

  const settings = readJsonFile(filePath);
  const rawCommands = isRecord(settings) ? settings.sensitiveCommands : null;
  const commands: SnowCliSensitiveCommand[] = [];

  if (Array.isArray(rawCommands)) {
    rawCommands.forEach((item, index) => {
      const command = normalizeSnowCliCommand(item, index);
      if (command) {
        commands.push(command);
      }
    });
  }

  return { scope, commands, exists: true };
};

const toNativeInput = (
  scope: SensitiveCommandScope,
  command: SnowCliSensitiveCommand,
  sortOrder: number
): SensitiveCommandConfigInput => ({
  commandId: command.id,
  scope,
  pattern: command.pattern,
  description: command.description,
  enabled: command.enabled,
  isPreset: command.isPreset,
  sortOrder,
  source: SENSITIVE_COMMAND_SOURCE_SNOW_CLI,
});

const persistSensitiveCommandConfigs = (
  native: NativeBridge,
  configs: SnowCliSensitiveCommandConfig[]
): void => {
  const importKeys = new Set<string>();

  configs.forEach((config) => {
    if (!config.exists) {
      return;
    }

    config.commands.forEach((command, index) => {
      const input = toNativeInput(config.scope, command, index);
      importKeys.add(`${input.scope}:${input.commandId}`);
      native.upsertSensitiveCommandConfig(input);
    });
  });

  for (const item of native.listSensitiveCommandConfigs()) {
    const key = `${item.scope}:${item.commandId}`;
    if (item.source === SENSITIVE_COMMAND_SOURCE_SNOW_CLI && !importKeys.has(key)) {
      native.deleteSensitiveCommandConfig(item.commandId, item.scope);
    }
  }
};

export const readSnowCliSensitiveCommandConfig = (
  native: NativeBridge
): SensitiveCommandConfigRecord[] => {
  const configs = [
    readConfigByScope("global", SNOW_CLI_GLOBAL_SETTINGS_FILE),
    readConfigByScope("project", SNOW_CLI_PROJECT_SETTINGS_FILE),
  ];

  persistSensitiveCommandConfigs(native, configs);
  return native.listSensitiveCommandConfigs();
};

export const normalizeSensitiveCommandConfig = (
  value: unknown
): SensitiveCommandConfigInput => {
  const source = isRecord(value) ? value : {};
  const pattern = toText(source.pattern).trim();
  const description = toText(source.description).trim();
  const rawSortOrder = Number(source.sortOrder ?? 0);

  if (!pattern) {
    throw new Error("Sensitive command pattern is required");
  }

  return {
    commandId: toText(source.commandId).trim() || toCommandId(pattern),
    scope: normalizeScope(source.scope),
    pattern,
    description,
    enabled: source.enabled !== false,
    isPreset: source.isPreset === true,
    sortOrder: Number.isInteger(rawSortOrder) ? rawSortOrder : 0,
    source: toText(source.source).trim() || SENSITIVE_COMMAND_SOURCE_MANUAL,
  };
};
