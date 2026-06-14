import type { SystemPromptItemRecord } from "../../../../preload";

export type SystemPromptSettingsPanelProps = {
  onClose?: () => void;
};

export type PromptDraft = {
  promptId: string;
  name: string;
  content: string;
};

export type SystemPromptItem = SystemPromptItemRecord;
