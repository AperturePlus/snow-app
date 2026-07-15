import type { RefObject } from "react";
import type { LucideIcon } from "lucide-react";
import type { ApiConfigRecord, Model, TokenUsage } from "../../../../preload";
export type ChatInputSendOptions = {
  model?: string;
};
export type ChatInputProps = {
  placeholder?: string;
  projectId?: string;
  projectName?: string;
  onSend?: (message: string, options: ChatInputSendOptions) => void;
  isStreaming?: boolean;
  isAborting?: boolean;
  onAbort?: () => void;
  tokenUsage?: TokenUsage | null;
  draftToRestore?: string | null;
  onDraftRestored?: () => void;
  pendingMessages?: string[];
  onWithdrawPendingMessage?: (index: number) => string | null;
  onCompactConversation?: (model?: string) => void | Promise<void>;
  yoloMode?: boolean;
  isUpdatingYoloMode?: boolean;
  onYoloModeChange?: (enabled: boolean) => void;
  onRefreshYoloMode?: () => void | Promise<boolean | void>;
  autoScrollEnabled?: boolean;
  onAutoScrollChange?: (enabled: boolean) => void;
  isCompacting?: boolean;
};

export type RequestMethod = "chat" | "responses" | "gemini" | "anthropic";

export type ThinkingOption = {
  value: string;
  label: string;
  icon: LucideIcon;
};

export type ChatInputState = {
  value: string;
  textareaRef: RefObject<HTMLDivElement | null>;
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
  isStreaming: boolean;
  isAborting: boolean;
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
  handleChange: (value: string) => void;
  handleSend: () => void;
  handleAbort: () => void;
  handleKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  handleSelectModel: (modelId: string) => Promise<void>;
  handleOpenManualMode: () => void;
  handleConfirmManualModel: () => Promise<void>;
  handleManualKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  handleRetryFetchModels: () => Promise<void>;
  handleToggleModelDropdown: () => void;
  handleSelectThinking: (nextValue: string) => Promise<void>;
  restoreContent: (content: string) => void;
};

export type ChatInputViewProps = ChatInputState &
  ChatInputActions & {
    placeholder: string;
    projectId?: string;
    projectName?: string;
    tokenUsage: TokenUsage | null;
    pendingMessages: string[];
    onWithdrawPendingMessage?: (index: number) => string | null;
    onCompactConversation?: (model?: string) => void | Promise<void>;
    yoloMode: boolean;
    isUpdatingYoloMode: boolean;
    onYoloModeChange?: (enabled: boolean) => void;
    onRefreshYoloMode?: () => void | Promise<boolean | void>;
    autoScrollEnabled: boolean;
    onAutoScrollChange?: (enabled: boolean) => void;
    isCompacting: boolean;
  };
