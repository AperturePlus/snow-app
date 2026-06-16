import {
  useState,
  useRef,
  useCallback,
  useLayoutEffect,
  useEffect,
  useMemo,
} from "react";
import {
  Plus,
  Hand,
  ChevronDown,
  ArrowUp,
  Bot,
  Loader2,
  Check,
  Keyboard,
  AlertCircle,
  BrainCircuit,
  CircleDot,
  CircleOff,
  Gauge,
  Activity,
  Rocket,
  ChevronsUp,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useI18n } from "../../i18n";
import type { ApiConfigRecord, Model } from "../../../preload";

type ChatInputProps = {
  placeholder?: string;
  onSend?: (message: string) => void;
};

type RequestMethod = "chat" | "responses" | "gemini" | "anthropic";
type ThinkingOption = {
  value: string;
  label: string;
  icon: LucideIcon;
};

const MAX_TEXTAREA_ROWS = 8;
const DEFAULT_TEXTAREA_ROWS = 3;
const DEFAULT_THINKING_VALUE = "high";

const THINKING_OPTIONS_BY_METHOD: Record<RequestMethod, ThinkingOption[]> = {
  anthropic: [
    { value: "low", label: "Low", icon: Gauge },
    { value: "medium", label: "Medium", icon: Activity },
    { value: "high", label: "High", icon: BrainCircuit },
    { value: "max", label: "Max", icon: Rocket },
  ],
  gemini: [
    { value: "minimal", label: "Minimal", icon: CircleDot },
    { value: "low", label: "Low", icon: Gauge },
    { value: "medium", label: "Medium", icon: Activity },
    { value: "high", label: "High", icon: BrainCircuit },
  ],
  responses: [
    { value: "none", label: "None", icon: CircleOff },
    { value: "low", label: "Low", icon: Gauge },
    { value: "medium", label: "Medium", icon: Activity },
    { value: "high", label: "High", icon: BrainCircuit },
    { value: "xhigh", label: "Extra High", icon: ChevronsUp },
  ],
  chat: [
    { value: "low", label: "Low", icon: Gauge },
    { value: "medium", label: "Medium", icon: Activity },
    { value: "high", label: "High", icon: BrainCircuit },
    { value: "max", label: "Max", icon: Rocket },
  ],
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeRequestMethod = (value: unknown): RequestMethod => {
  if (value === "responses" || value === "gemini" || value === "anthropic") {
    return value;
  }

  return "chat";
};

const parseConfigJson = (configJson: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(configJson);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const readNestedString = (
  source: Record<string, unknown>,
  key: string
): string | undefined => {
  const value = source[key];
  return typeof value === "string" ? value : undefined;
};

const isOptionValue = (
  options: ThinkingOption[],
  value: string | undefined
): value is string =>
  typeof value === "string" && options.some((option) => option.value === value);

const getThinkingValueFromConfig = (config: ApiConfigRecord): string => {
  const parsedConfig = parseConfigJson(config.configJson);
  const snowcfg = isRecord(parsedConfig.snowcfg) ? parsedConfig.snowcfg : {};
  const requestMethod = normalizeRequestMethod(
    config.requestMethod || snowcfg.requestMethod
  );
  const options = THINKING_OPTIONS_BY_METHOD[requestMethod];

  if (requestMethod === "anthropic") {
    const thinking = isRecord(snowcfg.thinking) ? snowcfg.thinking : {};
    const effort = readNestedString(thinking, "effort");
    return isOptionValue(options, effort) ? effort : DEFAULT_THINKING_VALUE;
  }

  if (requestMethod === "gemini") {
    const geminiThinking = isRecord(snowcfg.geminiThinking)
      ? snowcfg.geminiThinking
      : {};
    const thinkingLevel = readNestedString(geminiThinking, "thinkingLevel");
    return isOptionValue(options, thinkingLevel)
      ? thinkingLevel
      : DEFAULT_THINKING_VALUE;
  }

  if (requestMethod === "responses") {
    const responsesReasoning = isRecord(snowcfg.responsesReasoning)
      ? snowcfg.responsesReasoning
      : {};
    const effort = readNestedString(responsesReasoning, "effort");
    return isOptionValue(options, effort) ? effort : DEFAULT_THINKING_VALUE;
  }

  const chatThinking = isRecord(snowcfg.chatThinking)
    ? snowcfg.chatThinking
    : {};
  const reasoningEffort = readNestedString(chatThinking, "reasoning_effort");
  return isOptionValue(options, reasoningEffort)
    ? reasoningEffort
    : DEFAULT_THINKING_VALUE;
};

const buildConfigJsonWithThinking = (
  config: ApiConfigRecord,
  thinkingValue: string
): string => {
  const parsedConfig = parseConfigJson(config.configJson);
  const snowcfg = {
    ...(isRecord(parsedConfig.snowcfg) ? parsedConfig.snowcfg : {}),
  };
  const requestMethod = normalizeRequestMethod(
    config.requestMethod || snowcfg.requestMethod
  );

  snowcfg.requestMethod = config.requestMethod || requestMethod;

  if (requestMethod === "anthropic") {
    snowcfg.thinking = {
      type: "adaptive",
      effort: thinkingValue,
    };
  } else if (requestMethod === "gemini") {
    snowcfg.geminiThinking = {
      enabled: true,
      thinkingLevel: thinkingValue,
    };
  } else if (requestMethod === "responses") {
    snowcfg.responsesReasoning = {
      enabled: thinkingValue !== "none",
      effort: thinkingValue,
    };
  } else {
    snowcfg.chatThinking = {
      enabled: true,
      reasoning_effort: thinkingValue,
    };
  }

  return JSON.stringify({
    ...parsedConfig,
    snowcfg,
  });
};

const toConfigUpdatePayload = (
  config: ApiConfigRecord,
  thinkingValue: string
): ApiConfigRecord => ({
  ...config,
  apiKey: "",
  visionApiKey: "",
  visionBaseUrlMode: config.visionBaseUrlMode || "auto",
  configJson: buildConfigJsonWithThinking(config, thinkingValue),
});

export const ChatInput = ({
  placeholder = "Ask for follow-up changes",
  onSend,
}: ChatInputProps): React.JSX.Element => {
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
          error instanceof Error
            ? error.message
            : t("chat.loadModelsError", {
                defaultValue: "Failed to load models",
              })
        );
      } finally {
        setIsLoadingModels(false);
      }
    },
    [
      activeApiConfig?.advancedModel,
      isLoadingModels,
      modelError,
      models.length,
      t,
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

    onSend?.(trimmed);
    setValue("");

    const textarea = textareaRef.current;
    if (textarea) {
      requestAnimationFrame(() => {
        adjustHeight();
      });
    }
  }, [value, onSend, adjustHeight]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== "Enter") {
        return;
      }

      if (event.shiftKey) {
        return;
      }

      event.preventDefault();
      handleSend();
    },
    [handleSend]
  );

  const handleSelectModel = useCallback((modelId: string) => {
    setSelectedModel(modelId);
    setIsDropdownOpen(false);
    setIsManualMode(false);
  }, []);

  const handleOpenManualMode = useCallback(() => {
    setIsManualMode(true);
    setManualValue(selectedModel);
  }, [selectedModel]);

  const handleConfirmManualModel = useCallback(() => {
    const trimmed = manualValue.trim();
    if (trimmed) {
      setSelectedModel(trimmed);
    }
    setIsManualMode(false);
    setIsDropdownOpen(false);
  }, [manualValue]);

  const handleManualKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        handleConfirmManualModel();
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
  const thinkingLabel = activeThinkingOption.label;
  const ActiveThinkingIcon = activeThinkingOption.icon;

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
        setSelectedModel(nextActiveConfig?.advancedModel || "");
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

  const displayModel =
    selectedModel || t("chat.selectModel", { defaultValue: "Select model" });

  return (
    <div className="input-area">
      <div className="input-box">
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          placeholder={placeholder}
          className="input-field"
          onChange={handleChange}
          onKeyDown={handleKeyDown}
        />
      </div>
      <div className="input-toolbar">
        <div className="toolbar-left">
          <button className="toolbar-btn" aria-label="Add attachment">
            <Plus size={16} />
          </button>
          <button className="toolbar-btn permissions" aria-label="Permissions">
            <Hand size={14} />
            <span>Default permissions</span>
            <ChevronDown size={12} />
          </button>
        </div>
        <div className="toolbar-right">
          <div className="model-selector" ref={dropdownRef}>
            <button
              className={`toolbar-btn model ${modelError ? "model-error" : ""}`}
              aria-label={t("chat.selectModel", {
                defaultValue: "Select model",
              })}
              aria-expanded={isDropdownOpen}
              onClick={handleToggleModelDropdown}
              disabled={isLoadingModels}
              type="button"
            >
              {isLoadingModels ? (
                <Loader2 size={14} className="model-icon spin" />
              ) : modelError ? (
                <AlertCircle size={14} className="model-icon" />
              ) : (
                <Bot size={14} className="model-icon" />
              )}
              <span className="model-name" title={displayModel}>
                {displayModel}
              </span>
              <ChevronDown size={12} />
            </button>
            {isDropdownOpen && (
              <div className="model-dropdown">
                {isManualMode ? (
                  <div className="model-manual-input">
                    <div className="model-manual-header">
                      <Keyboard size={14} />
                      <span>
                        {t("chat.manualModel", {
                          defaultValue: "Enter model manually",
                        })}
                      </span>
                    </div>
                    <input
                      autoFocus
                      value={manualValue}
                      onChange={(event) => setManualValue(event.target.value)}
                      onKeyDown={handleManualKeyDown}
                      placeholder={t("chat.manualModelPlaceholder", {
                        defaultValue: "e.g. gpt-4.1",
                      })}
                      className="model-manual-field"
                    />
                    <div className="model-manual-actions">
                      <button
                        className="model-manual-btn secondary"
                        onClick={() => setIsManualMode(false)}
                        type="button"
                      >
                        {t("common.cancel", { defaultValue: "Cancel" })}
                      </button>
                      <button
                        className="model-manual-btn primary"
                        onClick={handleConfirmManualModel}
                        disabled={!manualValue.trim()}
                        type="button"
                      >
                        {t("common.confirm", { defaultValue: "Confirm" })}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {modelError && (
                      <div className="model-dropdown-error">
                        <AlertCircle size={14} />
                        <span>{modelError}</span>
                        <button
                          className="model-dropdown-retry"
                          onClick={handleRetryFetchModels}
                          type="button"
                        >
                          {t("common.retry", { defaultValue: "Retry" })}
                        </button>
                      </div>
                    )}
                    <div className="model-dropdown-list">
                      {models.length === 0 &&
                        !modelError &&
                        !isLoadingModels && (
                          <div className="model-dropdown-empty">
                            {t("chat.noModelsFound", {
                              defaultValue: "No models found",
                            })}
                          </div>
                        )}
                      {models.map((model) => (
                        <button
                          key={model.id}
                          className={`model-dropdown-item ${
                            selectedModel === model.id ? "active" : ""
                          }`}
                          onClick={() => handleSelectModel(model.id)}
                          type="button"
                          title={model.id}
                        >
                          <span className="model-dropdown-item-name">
                            {model.id}
                          </span>
                          {selectedModel === model.id && (
                            <Check size={14} className="model-dropdown-check" />
                          )}
                        </button>
                      ))}
                    </div>
                    <div className="model-dropdown-footer">
                      <button
                        className="model-dropdown-manual"
                        onClick={handleOpenManualMode}
                        type="button"
                      >
                        <Keyboard size={14} />
                        <span>
                          {t("chat.manualModel", {
                            defaultValue: "Enter model manually",
                          })}
                        </span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
          <div className="thinking-selector" ref={thinkingDropdownRef}>
            <button
              className={`toolbar-btn quality ${
                thinkingError ? "thinking-error" : ""
              }`}
              aria-label="Thinking strength"
              aria-expanded={isThinkingDropdownOpen}
              onClick={() => setIsThinkingDropdownOpen((open) => !open)}
              disabled={
                !activeApiConfig || isLoadingApiConfig || isSavingThinking
              }
              title={
                thinkingError ??
                (isLoadingApiConfig
                  ? "Loading API configuration"
                  : `Thinking strength: ${thinkingLabel}`)
              }
              type="button"
            >
              {isLoadingApiConfig || isSavingThinking ? (
                <Loader2 size={14} className="model-icon spin" />
              ) : thinkingError ? (
                <AlertCircle size={14} className="model-icon" />
              ) : (
                <ActiveThinkingIcon size={14} className="model-icon" />
              )}
              <span>{thinkingLabel}</span>
              <ChevronDown size={12} />
            </button>
            {isThinkingDropdownOpen && (
              <div className="model-dropdown thinking-dropdown">
                <div className="thinking-dropdown-header">
                  <span>Thinking strength</span>
                  <small>{requestMethod}</small>
                </div>
                <div className="model-dropdown-list">
                  {thinkingOptions.map((option) => {
                    const ThinkingOptionIcon = option.icon;

                    return (
                      <button
                        key={option.value}
                        className={`model-dropdown-item ${
                          thinkingValue === option.value ? "active" : ""
                        }`}
                        onClick={() => void handleSelectThinking(option.value)}
                        type="button"
                      >
                        <span className="model-dropdown-item-name with-icon">
                          <ThinkingOptionIcon
                            size={14}
                            className="thinking-option-icon"
                          />
                          <span>{option.label}</span>
                        </span>
                        {thinkingValue === option.value && (
                          <Check size={14} className="model-dropdown-check" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <button
            className="send-btn"
            aria-label="Send"
            onClick={handleSend}
            disabled={!value.trim()}
          >
            <ArrowUp size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};
