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
  normalizeRequestMethod,
  toConfigUpdatePayload,
  toModelUpdatePayload,
} from "./configThinking";
import type { ChatInputActions, ChatInputState } from "./types";
import {
  createChangeChipHtml,
  createChipHtml,
  createCommitChipHtml,
  createImageChipHtml,
  parseContentSegments,
  renumberImageChips,
} from "./fileTagUtils";
type UseChatInputControllerParams = {
  conversationId?: string;
  onSend?: (message: string, options: { model?: string }) => void;
  isStreaming?: boolean;
  isAborting?: boolean;
  onAbort?: () => void;
  draftToRestore?: string | null;
  autoSendToken?: number;
  onDraftRestored?: () => void;
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
  conversationId,
  onSend,
  isStreaming = false,
  isAborting = false,
  onAbort,
  draftToRestore = null,
  autoSendToken = 0,
  onDraftRestored,
}: UseChatInputControllerParams): UseChatInputControllerResult => {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLDivElement>(null);

  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [isManualMode, setIsManualMode] = useState(false);
  const [manualValue, setManualValue] = useState("");
  const [runtimeApiConfig, setRuntimeApiConfig] =
    useState<ApiConfigRecord | null>(null);
  const [isLoadingApiConfig, setIsLoadingApiConfig] = useState(true);
  const [thinkingValue, setThinkingValue] = useState(DEFAULT_THINKING_VALUE);
  const [isSavingThinking, setIsSavingThinking] = useState(false);
  const [thinkingError, setThinkingError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

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

    const loadRuntimeApiConfig = async () => {
      setIsLoadingApiConfig(true);
      setThinkingError(null);
      setModelError(null);
      setModels([]);

      try {
        const [configs, conversation] = await Promise.all([
          window.snow.listApiConfigs(),
          conversationId
            ? window.snow.getChatConversation(conversationId)
            : Promise.resolve(null),
        ]);
        if (cancelled) {
          return;
        }

        let requestedProfile = "";
        if (conversation?.conversationType === "sub_agent") {
          const subAgentId = conversation.subAgentId.trim();
          if (!subAgentId) {
            throw new Error("Sub-agent configuration is not available");
          }

          const subAgentConfig = await window.snow.getSubAgentConfig(
            subAgentId
          );
          if (cancelled) {
            return;
          }
          if (!subAgentConfig) {
            throw new Error(`Sub-agent configuration not found: ${subAgentId}`);
          }
          requestedProfile = subAgentConfig.configProfile.trim();
        }

        const runtimeConfig = requestedProfile
          ? configs.find((config) => config.profileName === requestedProfile) ??
            null
          : configs.find((config) => config.isActive) ?? configs[0] ?? null;
        if (!runtimeConfig) {
          throw new Error(
            requestedProfile
              ? `Sub-agent API profile is not available: ${requestedProfile}`
              : "No API configuration found"
          );
        }

        setRuntimeApiConfig(runtimeConfig);
        setSelectedModel(runtimeConfig.advancedModel || "");
        setThinkingValue(getThinkingValueFromConfig(runtimeConfig));
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message =
          error instanceof Error
            ? error.message
            : "Failed to load API configuration";
        setRuntimeApiConfig(null);
        setSelectedModel("");
        setThinkingValue(DEFAULT_THINKING_VALUE);
        setModelError(message);
        setThinkingError(message);
      } finally {
        if (!cancelled) {
          setIsLoadingApiConfig(false);
        }
      }
    };

    void loadRuntimeApiConfig();

    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  const loadModels = useCallback(
    async (force = false) => {
      if (isLoadingModels || (!force && (models.length > 0 || modelError))) {
        return;
      }

      setIsLoadingModels(true);
      setModelError(null);

      try {
        if (!runtimeApiConfig) {
          throw new Error("API configuration is not available");
        }

        const availableModels = await window.snow.fetchAvailableModelsForConfig(
          {
            baseUrl: runtimeApiConfig.baseUrl,
            baseUrlMode: runtimeApiConfig.baseUrlMode,
            apiKey: runtimeApiConfig.apiKey,
            requestMethod: runtimeApiConfig.requestMethod,
            customHeaderSchemeId: runtimeApiConfig.customHeaderSchemeId,
          }
        );
        setModels(availableModels);

        if (availableModels.length > 0) {
          setSelectedModel(
            (currentModel) =>
              currentModel ||
              runtimeApiConfig.advancedModel ||
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
      runtimeApiConfig,
      isLoadingModels,
      labels.loadModelsError,
      modelError,
      models.length,
    ]
  );

  useEffect(() => {
    if (isStreaming && isModelMenuOpen) {
      setIsModelMenuOpen(false);
      setIsManualMode(false);
    }
  }, [isStreaming, isModelMenuOpen]);

  useEffect(() => {
    if (!isModelMenuOpen) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsModelMenuOpen(false);
        setIsManualMode(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isModelMenuOpen]);

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

  useEffect(() => {
    if (draftToRestore === null) {
      return;
    }

    setValue(draftToRestore);

    const textarea = textareaRef.current;
    if (textarea) {
      const segments = parseContentSegments(draftToRestore);
      const html = segments
        .map((segment) => {
          if (segment.type === "text") {
            return segment.content
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")
              .replace(/\n/g, "<br>");
          }
          if (segment.type === "image") {
            return createImageChipHtml(segment.tag);
          }
          if (segment.type === "commit") {
            return createCommitChipHtml(segment.tag);
          }
          if (segment.type === "change") {
            return createChangeChipHtml(segment.tag);
          }
          return createChipHtml(segment.tag);
        })
        .join("");

      textarea.innerHTML = html;
      // 固定 chip 宽度，确保 hover 显示 remove 按钮时布局不跳动、
      // 名字能正确省略。与新输入时 syncContent -> renumberImageChips 一致。
      renumberImageChips(textarea);
      textarea.dataset.empty = draftToRestore.trim() === "" ? "true" : "false";
      requestAnimationFrame(() => {
        adjustHeight();
        textarea.focus();
        const selection = window.getSelection();
        if (selection) {
          const range = document.createRange();
          range.selectNodeContents(textarea);
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
        }

        // If autoSendToken is non-zero, this draft was queued by
        // buildFromContent — automatically send it right after restore.
        if (autoSendToken > 0) {
          const message = draftToRestore.trim();
          if (message) {
            onSend?.(message, { model: selectedModel || undefined });
          }
          setValue("");
          textarea.innerHTML = "";
          textarea.dataset.empty = "true";
          adjustHeight();
        }
      });
    }

    onDraftRestored?.();
  }, [draftToRestore, onDraftRestored, adjustHeight, autoSendToken, onSend, selectedModel]);

  const handleChange = useCallback(
    (nextValue: string) => {
      setValue(nextValue);
      adjustHeight();
    },
    [adjustHeight]
  );

  const restoreContent = useCallback(
    (content: string) => {
      setValue(content);

      if (textareaRef.current) {
        const segments = parseContentSegments(content);
        const html = segments
          .map((segment) => {
            if (segment.type === "text") {
              return segment.content
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/\n/g, "<br>");
            }
            if (segment.type === "image") {
              return createImageChipHtml(segment.tag);
            }
            if (segment.type === "commit") {
              return createCommitChipHtml(segment.tag);
            }
            if (segment.type === "change") {
              return createChangeChipHtml(segment.tag);
            }
            return createChipHtml(segment.tag);
          })
          .join("");

        textareaRef.current.innerHTML = html;
        renumberImageChips(textareaRef.current);
        textareaRef.current.dataset.empty =
          content.trim() === "" ? "true" : "false";
        requestAnimationFrame(() => {
          adjustHeight();
          textareaRef.current?.focus();
        });
      }
    },
    [adjustHeight, textareaRef]
  );

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }

    onSend?.(trimmed, { model: selectedModel || undefined });
    setValue("");

    if (textareaRef.current) {
      textareaRef.current.innerHTML = "";
      textareaRef.current.dataset.empty = "true";
      requestAnimationFrame(() => {
        adjustHeight();
      });
    }
  }, [adjustHeight, onSend, selectedModel, value]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (
        event.key !== "Enter" ||
        event.shiftKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
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
      setIsModelMenuOpen(false);
      setIsManualMode(false);

      if (!runtimeApiConfig) {
        return;
      }

      try {
        const updatedConfigs = await window.snow.upsertApiConfig(
          toModelUpdatePayload(runtimeApiConfig, modelId)
        );
        const nextRuntimeConfig =
          updatedConfigs.find(
            (config) => config.profileName === runtimeApiConfig.profileName
          ) ?? null;
        setRuntimeApiConfig(nextRuntimeConfig);
      } catch {
        // 保存失败时保留用户选择，不回退
      }
    },
    [runtimeApiConfig]
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
    setIsModelMenuOpen(false);

    if (!runtimeApiConfig || !trimmed) {
      return;
    }

    try {
      const updatedConfigs = await window.snow.upsertApiConfig(
        toModelUpdatePayload(runtimeApiConfig, trimmed)
      );
      const nextRuntimeConfig =
        updatedConfigs.find(
          (config) => config.profileName === runtimeApiConfig.profileName
        ) ?? null;
      setRuntimeApiConfig(nextRuntimeConfig);
    } catch {
      // 保存失败时保留用户选择，不回退
    }
  }, [manualValue, runtimeApiConfig]);

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

  const handleToggleModelMenu = useCallback(() => {
    setIsModelMenuOpen((open) => {
      const nextOpen = !open;
      if (nextOpen) {
        void loadModels();
      }
      return nextOpen;
    });
  }, [loadModels]);

  const requestMethod = normalizeRequestMethod(runtimeApiConfig?.requestMethod);
  const thinkingOptions = THINKING_OPTIONS_BY_METHOD[requestMethod];
  const activeThinkingOption = useMemo(() => {
    const matchingOption = thinkingOptions.find(
      (option) => option.value === thinkingValue
    );

    return {
      label: matchingOption?.label ?? thinkingValue,
      icon: matchingOption?.icon ?? BrainCircuit,
    };
  }, [thinkingOptions, thinkingValue]);

  const handleSelectThinking = useCallback(
    async (nextValue: string) => {
      if (!runtimeApiConfig) {
        return;
      }

      setThinkingValue(nextValue);
      setIsModelMenuOpen(false);
      setIsSavingThinking(true);
      setThinkingError(null);

      try {
        const updatedConfigs = await window.snow.upsertApiConfig(
          toConfigUpdatePayload(runtimeApiConfig, nextValue)
        );
        const nextRuntimeConfig =
          updatedConfigs.find(
            (config) => config.profileName === runtimeApiConfig.profileName
          ) ?? null;
        setRuntimeApiConfig(nextRuntimeConfig);
        setThinkingValue(
          nextRuntimeConfig
            ? getThinkingValueFromConfig(nextRuntimeConfig)
            : nextValue
        );
      } catch (error) {
        setThinkingValue(getThinkingValueFromConfig(runtimeApiConfig));
        setThinkingError(
          error instanceof Error
            ? error.message
            : t("chat.saveThinkingStrengthError")
        );
      } finally {
        setIsSavingThinking(false);
      }
    },
    [runtimeApiConfig, t]
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
    isModelMenuOpen,
    isManualMode,
    manualValue,
    dropdownRef,
    runtimeApiConfig,
    requestMethod,
    thinkingOptions,
    thinkingValue,
    thinkingLabel: activeThinkingOption.label,
    ActiveThinkingIcon: activeThinkingOption.icon,
    isLoadingApiConfig,
    isSavingThinking,
    thinkingError,
    labels,
    isStreaming,
    isAborting,
    setManualValue,
    setIsManualMode,
    handleChange,
    handleSend,
    handleAbort: onAbort ?? (() => {}),
    handleKeyDown,
    handleSelectModel,
    handleOpenManualMode,
    handleConfirmManualModel,
    handleManualKeyDown,
    handleRetryFetchModels,
    handleToggleModelMenu,
    handleSelectThinking,
    restoreContent,
  };
};
