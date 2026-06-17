import type { RefObject } from "react";
import type { LucideIcon } from "lucide-react";
import type { ApiConfigRecord, Model } from "../../../../preload";
export type ChatInputSendOptions = {
  model?: string;
};

export type ChatInputProps = {
  placeholder?: string;
  onSend?: (message: string, options: ChatInputSendOptions) => void;
};

export type RequestMethod = "chat" | "responses" | "gemini" | "anthropic";

export type ThinkingOption = {
  value: string;
  label: string;
  icon: LucideIcon;
};

export type ChatInputState = {
  value: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  models: Model[];
  selectedModel: string;
  displayModel: string;
  isLoadingModels: boolean;
  modelError: string | null;
  isDropdownOpen: boolean;
  isManualMode: boolean;
  manualValue: string;
  dropdownRef: RefObject<HTMLDivElement | null>;
  activeApiConfig: ApiConfigRecord | null;
  requestMethod: RequestMethod;
  thinkingOptions: ThinkingOption[];
  thinkingValue: string;
  thinkingLabel: string;
  ActiveThinkingIcon: LucideIcon;
  isThinkingDropdownOpen: boolean;
  isLoadingApiConfig: boolean;
  isSavingThinking: boolean;
  thinkingError: string | null;
  thinkingDropdownRef: RefObject<HTMLDivElement | null>;
  labels: ChatInputLabels;
};

export type ChatInputLabels = {
  selectModel: string;
  loadModelsError: string;
  loadingModels: string;
  refreshModels: string;
  manualModel: string;
  manualModelPlaceholder: string;
  noModelsFound: string;
  cancel: string;
  confirm: string;
  retry: string;
};

export type ChatInputActions = {
  setManualValue: (value: string) => void;
  setIsManualMode: (value: boolean) => void;
  setIsThinkingDropdownOpen: (updater: (open: boolean) => boolean) => void;
  handleChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  handleSend: () => void;
  handleKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  handleSelectModel: (modelId: string) => void;
  handleOpenManualMode: () => void;
  handleConfirmManualModel: () => void;
  handleManualKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  handleRetryFetchModels: () => Promise<void>;
  handleToggleModelDropdown: () => void;
  handleSelectThinking: (nextValue: string) => Promise<void>;
};

export type ChatInputViewProps = ChatInputState &
  ChatInputActions & {
    placeholder: string;
  };
