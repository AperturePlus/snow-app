import { existsSync } from "node:fs";
import type {
  NativeBridge,
  ProjectSensitiveCommandConfigInput,
  SensitiveCommandConfigInput,
  SensitiveCommandConfigRecord,
} from "../native/types";
import { SNOW_CLI_GLOBAL_SETTINGS_FILE } from "../snowCli/paths";
import { readJsonFile } from "../utils/jsonFile";
import { isRecord, toBoolean, toText } from "../utils/value";

const SENSITIVE_COMMAND_SOURCE_SNOW_CLI = "snow-cli";
const SENSITIVE_COMMAND_SOURCE_MANUAL = "manual";

type SnowCliSensitiveCommand = {
  id: string;
  pattern: string;
  description: string;
  enabled: boolean;
  isPreset: boolean;
};

type SnowCliSensitiveCommandConfig = {
  commands: SnowCliSensitiveCommand[];
  exists: boolean;
};

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

const readSnowCliConfig = (filePath: string): SnowCliSensitiveCommandConfig => {
  if (!existsSync(filePath)) {
    return { commands: [], exists: false };
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

  return { commands, exists: true };
};

const toNativeInput = (
  command: SnowCliSensitiveCommand,
  sortOrder: number
): SensitiveCommandConfigInput => ({
  commandId: command.id,
  pattern: command.pattern,
  description: command.description,
  enabled: command.enabled,
  isPreset: command.isPreset,
  sortOrder,
  source: SENSITIVE_COMMAND_SOURCE_SNOW_CLI,
});

const persistSensitiveCommandConfigs = async (
  native: NativeBridge,
  configs: SnowCliSensitiveCommandConfig[]
): Promise<void> => {
  const importKeys = new Set<string>();

  for (const config of configs) {
    if (!config.exists) {
      continue;
    }

    for (const [index, command] of config.commands.entries()) {
      const input = toNativeInput(command, index);
      importKeys.add(input.commandId);
      await native.upsertSensitiveCommandConfig(input);
    }
  }

  const existing = await native.listSensitiveCommandConfigs();
  for (const item of existing) {
    if (
      item.source === SENSITIVE_COMMAND_SOURCE_SNOW_CLI &&
      !importKeys.has(item.commandId)
    ) {
      await native.deleteSensitiveCommandConfig(item.commandId);
    }
  }
};

export const readSnowCliSensitiveCommandConfig = async (
  native: NativeBridge
): Promise<SensitiveCommandConfigRecord[]> => {
  const configs = [readSnowCliConfig(SNOW_CLI_GLOBAL_SETTINGS_FILE)];

  await persistSensitiveCommandConfigs(native, configs);
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
    pattern,
    description,
    enabled: source.enabled !== false,
    isPreset: source.isPreset === true,
    sortOrder: Number.isInteger(rawSortOrder) ? rawSortOrder : 0,
    source: toText(source.source).trim() || SENSITIVE_COMMAND_SOURCE_MANUAL,
  };
};

export const normalizeProjectSensitiveCommandConfig = (
  value: unknown
): ProjectSensitiveCommandConfigInput => {
  const source = isRecord(value) ? value : {};
  const pattern = toText(source.pattern).trim();
  const rawSortOrder = Number(source.sortOrder ?? 0);

  if (!pattern) {
    throw new Error("Sensitive command pattern is required");
  }

  return {
    commandId: toText(source.commandId).trim(),
    pattern,
    description: toText(source.description).trim(),
    enabled: source.enabled !== false,
    sortOrder: Number.isInteger(rawSortOrder) ? rawSortOrder : 0,
  };
};
