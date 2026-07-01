import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { BrainCircuit } from "lucide-react";
import type { ApiConfigRecord, Model } from "../../../../preload";
import { useI18n } from "../../../i18n";
import {
  DEFAULT_TEXTAREA_ROWS,
  DEFAULT_THINKING_VALUE,
  MAX_TEXTAREA_ROWS,
  THINKING_OPTIONS_BY_METHOD,
} from "./constants";
import {
  getThinkingValueFromConfig,
  isOptionValue,
  normalizeRequestMethod,
  toConfigUpdatePayload,
  toModelUpdatePayload,
} from "./configThinking";
import type { ChatInputActions, ChatInputState } from "./types";
type UseChatInputControllerParams = {
  onSend?: (message: string, options: { model?: string }) => void;
  isStreaming?: boolean;
  onAbort?: () => void;
};

type UseChatInputControllerResult = ChatInputState & ChatInputActions;

const isComposingKeyboardEvent = (
  event: React.KeyboardEvent<HTMLElement>
): boolean => {
  const nativeEvent = event.nativeEvent;
  const nativeEventWithKeyCode = nativeEvent as unknown as { keyCode?: number };

  return nativeEvent.isComposing || nativeEventWithKeyCode.keyCode === 229;
};

export const useChatInputController = ({
  onSend,
  isStreaming = false,
  onAbort,
}: UseChatInputControllerParams): UseChatInputControllerResult => {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isManualMode, setIsManualMode] = useState(false);
  const [manualValue, setManualValue] = useState("");
  const [activeApiConfig, setActiveApiConfig] =
    useState<ApiConfigRecord | null>(null);
  const [isLoadingApiConfig, setIsLoadingApiConfig] = useState(true);
  const [thinkingValue, setThinkingValue] = useState(DEFAULT_THINKING_VALUE);
  const [isThinkingDropdownOpen, setIsThinkingDropdownOpen] = useState(false);
  const [isSavingThinking, setIsSavingThinking] = useState(false);
  const [thinkingError, setThinkingError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const thinkingDropdownRef = useRef<HTMLDivElement>(null);

  const labels = useMemo(
    () => ({
      selectModel: t("chat.selectModel", { defaultValue: "Select model" }),
      loadModelsError: t("chat.loadModelsError", {
        defaultValue: "Failed to load models",
      }),
      loadingModels: t("chat.loadingModels", {
        defaultValue: "Loading models...",
      }),
      refreshModels: t("chat.refreshModels", {
        defaultValue: "Refresh models",
      }),
      manualModel: t("chat.manualModel", {
        defaultValue: "Enter model manually",
      }),
      manualModelPlaceholder: t("chat.manualModelPlaceholder", {
        defaultValue: "e.g. gpt-4.1",
      }),
      noModelsFound: t("chat.noModelsFound", {
        defaultValue: "No models found",
      }),
      cancel: t("common.cancel", { defaultValue: "Cancel" }),
      confirm: t("common.confirm", { defaultValue: "Confirm" }),
      retry: t("common.retry", { defaultValue: "Retry" }),
    }),
    [t]
  );

  useEffect(() => {
    let cancelled = false;

    const loadActiveApiConfig = async () => {
      setIsLoadingApiConfig(true);
      setThinkingError(null);

      try {
        const configs = await window.snow.listApiConfigs();
        if (cancelled) {
          return;
        }

        const activeConfig =
          configs.find((config) => config.isActive) ?? configs[0] ?? null;
        setActiveApiConfig(activeConfig);
        setSelectedModel(activeConfig?.advancedModel || "");
        setThinkingValue(
          activeConfig
            ? getThinkingValueFromConfig(activeConfig)
            : DEFAULT_THINKING_VALUE
        );
      } catch (error) {
        if (cancelled) {
          return;
        }

        setActiveApiConfig(null);
        setThinkingValue(DEFAULT_THINKING_VALUE);
        setThinkingError(
          error instanceof Error
            ? error.message
            : "Failed to load API configuration"
        );
      } finally {
        if (!cancelled) {
          setIsLoadingApiConfig(false);
        }
      }
    };

    void loadActiveApiConfig();

    return () => {
      cancelled = true;
    };
  }, []);

  const loadModels = useCallback(
    async (force = false) => {
      if (isLoadingModels || (!force && (models.length > 0 || modelError))) {
        return;
      }

      setIsLoadingModels(true);
      setModelError(null);

      try {
        const availableModels = await window.snow.fetchAvailableModels();
        setModels(availableModels);

        if (availableModels.length > 0) {
          setSelectedModel(
            (currentModel) =>
              currentModel ||
              activeApiConfig?.advancedModel ||
              availableModels[0].id
          );
        }
      } catch (error) {
        setModelError(
          error instanceof Error ? error.message : labels.loadModelsError
        );
      } finally {
        setIsLoadingModels(false);
      }
    },
    [
      activeApiConfig?.advancedModel,
      isLoadingModels,
      labels.loadModelsError,
      modelError,
      models.length,
    ]
  );

  useEffect(() => {
    if (!isDropdownOpen && !isThinkingDropdownOpen) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (
        isDropdownOpen &&
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsDropdownOpen(false);
        setIsManualMode(false);
      }

      if (
        isThinkingDropdownOpen &&
        thinkingDropdownRef.current &&
        !thinkingDropdownRef.current.contains(event.target as Node)
      ) {
        setIsThinkingDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isDropdownOpen, isThinkingDropdownOpen]);

  const adjustHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = "auto";
    const lineHeight =
      parseInt(getComputedStyle(textarea).lineHeight, 10) || 20;
    const minHeight = lineHeight * DEFAULT_TEXTAREA_ROWS;
    const maxHeight = lineHeight * MAX_TEXTAREA_ROWS;
    textarea.style.height = `${Math.min(
      Math.max(textarea.scrollHeight, minHeight),
      maxHeight
    )}px`;
  }, []);

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      setValue(event.target.value);
      adjustHeight();
    },
    [adjustHeight]
  );

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }

    onSend?.(trimmed, { model: selectedModel || undefined });
    setValue("");

    if (textareaRef.current) {
      requestAnimationFrame(() => {
        adjustHeight();
      });
    }
  }, [adjustHeight, onSend, selectedModel, value]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (
        event.key !== "Enter" ||
        event.shiftKey ||
        isComposingKeyboardEvent(event)
      ) {
        return;
      }

      event.preventDefault();
      handleSend();
    },
    [handleSend]
  );

  const handleSelectModel = useCallback(
    async (modelId: string) => {
      setSelectedModel(modelId);
      setIsDropdownOpen(false);
      setIsManualMode(false);

      if (!activeApiConfig) {
        return;
      }

      try {
        const updatedConfigs = await window.snow.upsertApiConfig(
          toModelUpdatePayload(activeApiConfig, modelId)
        );
        const nextActiveConfig =
          updatedConfigs.find((config) => config.isActive) ??
          updatedConfigs[0] ??
          null;
        setActiveApiConfig(nextActiveConfig);
      } catch {
        // 保存失败时保留用户选择，不回退
      }
    },
    [activeApiConfig]
  );

  const handleOpenManualMode = useCallback(() => {
    setIsManualMode(true);
    setManualValue(selectedModel);
  }, [selectedModel]);

  const handleConfirmManualModel = useCallback(async () => {
    const trimmed = manualValue.trim();
    if (trimmed) {
      setSelectedModel(trimmed);
    }
    setIsManualMode(false);
    setIsDropdownOpen(false);

    if (!activeApiConfig || !trimmed) {
      return;
    }

    try {
      const updatedConfigs = await window.snow.upsertApiConfig(
        toModelUpdatePayload(activeApiConfig, trimmed)
      );
      const nextActiveConfig =
        updatedConfigs.find((config) => config.isActive) ??
        updatedConfigs[0] ??
        null;
      setActiveApiConfig(nextActiveConfig);
    } catch {
      // 保存失败时保留用户选择，不回退
    }
  }, [activeApiConfig, manualValue]);

  const handleManualKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        if (isComposingKeyboardEvent(event)) {
          return;
        }

        event.preventDefault();
        void handleConfirmManualModel();
      } else if (event.key === "Escape") {
        setIsManualMode(false);
      }
    },
    [handleConfirmManualModel]
  );

  const handleRetryFetchModels = useCallback(async () => {
    await loadModels(true);
  }, [loadModels]);

  const handleToggleModelDropdown = useCallback(() => {
    setIsDropdownOpen((open) => {
      const nextOpen = !open;
      if (nextOpen) {
        void loadModels();
      }
      return nextOpen;
    });
  }, [loadModels]);

  const requestMethod = normalizeRequestMethod(activeApiConfig?.requestMethod);
  const thinkingOptions = THINKING_OPTIONS_BY_METHOD[requestMethod];
  const activeThinkingOption = useMemo(
    () =>
      thinkingOptions.find((option) => option.value === thinkingValue) ??
      thinkingOptions[0] ?? {
        value: DEFAULT_THINKING_VALUE,
        label: "High",
        icon: BrainCircuit,
      },
    [thinkingOptions, thinkingValue]
  );

  useEffect(() => {
    if (thinkingOptions.length === 0) {
      return;
    }

    if (!isOptionValue(thinkingOptions, thinkingValue)) {
      setThinkingValue(thinkingOptions[0]?.value ?? DEFAULT_THINKING_VALUE);
    }
  }, [thinkingOptions, thinkingValue]);

  const handleSelectThinking = useCallback(
    async (nextValue: string) => {
      if (!activeApiConfig) {
        return;
      }

      setThinkingValue(nextValue);
      setIsThinkingDropdownOpen(false);
      setIsSavingThinking(true);
      setThinkingError(null);

      try {
        const updatedConfigs = await window.snow.upsertApiConfig(
          toConfigUpdatePayload(activeApiConfig, nextValue)
        );
        const nextActiveConfig =
          updatedConfigs.find((config) => config.isActive) ??
          updatedConfigs[0] ??
          null;
        setActiveApiConfig(nextActiveConfig);
        setThinkingValue(
          nextActiveConfig
            ? getThinkingValueFromConfig(nextActiveConfig)
            : nextValue
        );
      } catch (error) {
        setThinkingValue(getThinkingValueFromConfig(activeApiConfig));
        setThinkingError(
          error instanceof Error
            ? error.message
            : "Failed to save thinking strength"
        );
      } finally {
        setIsSavingThinking(false);
      }
    },
    [activeApiConfig]
  );

  useLayoutEffect(() => {
    adjustHeight();
  }, [adjustHeight]);

  const displayModel = selectedModel || labels.selectModel;

  return {
    value,
    textareaRef,
    models,
    selectedModel,
    displayModel,
    isLoadingModels,
    modelError,
    isDropdownOpen,
    isManualMode,
    manualValue,
    dropdownRef,
    activeApiConfig,
    requestMethod,
    thinkingOptions,
    thinkingValue,
    thinkingLabel: activeThinkingOption.label,
    ActiveThinkingIcon: activeThinkingOption.icon,
    isThinkingDropdownOpen,
    isLoadingApiConfig,
    isSavingThinking,
    thinkingError,
    thinkingDropdownRef,
    labels,
    isStreaming,
    setManualValue,
    setIsManualMode,
    setIsThinkingDropdownOpen,
    handleChange,
    handleSend,
    handleAbort: onAbort ?? (() => {}),
    handleKeyDown,
    handleSelectModel,
    handleOpenManualMode,
    handleConfirmManualModel,
    handleManualKeyDown,
    handleRetryFetchModels,
    handleToggleModelDropdown,
    handleSelectThinking,
  };
};
