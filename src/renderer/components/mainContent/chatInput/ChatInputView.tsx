import {
  AlertCircle,
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  Hand,
  Keyboard,
  Loader2,
  Plus,
} from "lucide-react";
import type { ChatInputViewProps } from "./types";

export const ChatInputView = ({
  placeholder,
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
  thinkingLabel,
  ActiveThinkingIcon,
  isThinkingDropdownOpen,
  isLoadingApiConfig,
  isSavingThinking,
  thinkingError,
  thinkingDropdownRef,
  labels,
  setManualValue,
  setIsManualMode,
  setIsThinkingDropdownOpen,
  handleChange,
  handleSend,
  handleKeyDown,
  handleSelectModel,
  handleOpenManualMode,
  handleConfirmManualModel,
  handleManualKeyDown,
  handleRetryFetchModels,
  handleToggleModelDropdown,
  handleSelectThinking,
}: ChatInputViewProps): React.JSX.Element => (
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
            aria-label={labels.selectModel}
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
                    <span>{labels.manualModel}</span>
                  </div>
                  <input
                    autoFocus
                    value={manualValue}
                    onChange={(event) => setManualValue(event.target.value)}
                    onKeyDown={handleManualKeyDown}
                    placeholder={labels.manualModelPlaceholder}
                    className="model-manual-field"
                  />
                  <div className="model-manual-actions">
                    <button
                      className="model-manual-btn secondary"
                      onClick={() => setIsManualMode(false)}
                      type="button"
                    >
                      {labels.cancel}
                    </button>
                    <button
                      className="model-manual-btn primary"
                      onClick={handleConfirmManualModel}
                      disabled={!manualValue.trim()}
                      type="button"
                    >
                      {labels.confirm}
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
                        {labels.retry}
                      </button>
                    </div>
                  )}
                  <div className="model-dropdown-list">
                    {models.length === 0 && !modelError && !isLoadingModels && (
                      <div className="model-dropdown-empty">
                        {labels.noModelsFound}
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
                      <span>{labels.manualModel}</span>
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
            disabled={!activeApiConfig || isLoadingApiConfig || isSavingThinking}
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
