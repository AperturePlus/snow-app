import type {
  SensitiveCommandConfig,
  SensitiveCommandDraft,
  SensitiveCommandInput,
} from "./types";

export const EMPTY_SENSITIVE_COMMAND_DRAFT: SensitiveCommandDraft = {
  commandId: "",
  scope: "global",
  pattern: "",
  description: "",
  enabled: true,
  isPreset: false,
  sortOrder: 0,
  source: "manual",
};

export const toDraft = (
  command: SensitiveCommandConfig
): SensitiveCommandDraft => ({
  commandId: command.commandId,
  scope: command.scope,
  pattern: command.pattern,
  description: command.description,
  enabled: command.enabled,
  isPreset: command.isPreset,
  sortOrder: command.sortOrder,
  source: command.source,
});

export const toInput = (
  draft: SensitiveCommandDraft,
  fallbackSortOrder: number
): SensitiveCommandInput => ({
  commandId: draft.commandId,
  scope: draft.scope,
  pattern: draft.pattern.trim(),
  description: draft.description.trim(),
  enabled: draft.enabled,
  isPreset: draft.isPreset,
  sortOrder: draft.commandId ? draft.sortOrder : fallbackSortOrder,
  source: draft.source || "manual",
});

export const hasDuplicatePattern = (
  commands: SensitiveCommandConfig[],
  draft: SensitiveCommandDraft
): boolean => {
  const normalizedPattern = draft.pattern.trim();
  if (!normalizedPattern) {
    return false;
  }

  return commands.some(
    (command) =>
      command.pattern.trim() === normalizedPattern &&
      (command.commandId !== draft.commandId || command.scope !== draft.scope)
  );
};
