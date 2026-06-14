import type {
  SensitiveCommandConfigInput,
  SensitiveCommandConfigRecord,
} from "../../../../preload";

export type SensitiveCommandConfig = SensitiveCommandConfigRecord;
export type SensitiveCommandInput = SensitiveCommandConfigInput;

export type SensitiveCommandDraft = {
  commandId: string;
  scope: string;
  pattern: string;
  description: string;
  enabled: boolean;
  isPreset: boolean;
  sortOrder: number;
  source: string;
};
