import type {
  ProjectSensitiveCommandConfigRecord,
  SensitiveCommandConfigInput,
  SensitiveCommandConfigRecord,
} from "../../../../preload";

export type SensitiveCommandConfig = SensitiveCommandConfigRecord;
export type ProjectSensitiveCommandConfig = ProjectSensitiveCommandConfigRecord;
export type SensitiveCommandInput = SensitiveCommandConfigInput;

export type SensitiveCommandDraft = {
  commandId: string;
  pattern: string;
  description: string;
  enabled: boolean;
  isPreset: boolean;
  sortOrder: number;
  source: string;
};
