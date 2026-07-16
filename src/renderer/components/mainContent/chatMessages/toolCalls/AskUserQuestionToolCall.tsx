import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronRight,
  Loader2,
  MessageCircleQuestion,
  Plus,
  Send,
  X,
} from "lucide-react";
import { useI18n } from "../../../../i18n";
import { useChatConversationContext } from "../components/ChatConversationContext";
import type { ToolCallInfo } from "../hooks/useChatConversation";
import { ToolNameBadge } from "./shared/ToolNameBadge";

type AskUserQuestionToolCallProps = {
  toolCall: ToolCallInfo;
};

type ParsedQuestionArgs = {
  question: string;
  options: string[];
};

type ParsedQuestionResult = {
  cancelled: boolean;
  selectedOptions: string[];
  customAnswers: string[];
};

const parseQuestionArgs = (
  argumentsJson: string
): ParsedQuestionArgs | null => {
  try {
    const parsed: unknown = JSON.parse(argumentsJson);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return null;
    }

    const record = parsed as Record<string, unknown>;
    if (typeof record.question !== "string" || !Array.isArray(record.options)) {
      return null;
    }

    const options = record.options.filter(
      (option): option is string =>
        typeof option === "string" && Boolean(option.trim())
    );
    return {
      question: record.question.trim(),
      options,
    };
  } catch {
    return null;
  }
};

const parseQuestionResult = (
  resultJson: string | undefined
): ParsedQuestionResult | null => {
  if (!resultJson) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(resultJson);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return null;
    }

    const record = parsed as Record<string, unknown>;
    if (record.answered !== true && record.cancelled !== true) {
      return null;
    }

    const readAnswers = (value: unknown): string[] =>
      Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : [];
    return {
      cancelled: record.cancelled === true,
      selectedOptions: readAnswers(record.selectedOptions),
      customAnswers: readAnswers(record.customAnswers),
    };
  } catch {
    return null;
  }
};

export const AskUserQuestionToolCall = ({
  toolCall,
}: AskUserQuestionToolCallProps): React.JSX.Element => {
  const { t } = useI18n();
  const { answerUserQuestion, cancelUserQuestion } =
    useChatConversationContext();
  const parsedArgs = useMemo(
    () => parseQuestionArgs(toolCall.arguments),
    [toolCall.arguments]
  );
  const parsedResult = useMemo(
    () => parseQuestionResult(toolCall.result),
    [toolCall.result]
  );
  const questionState = toolCall.userQuestion;
  const question = questionState?.question ?? parsedArgs?.question ?? "";
  const options = questionState?.options ?? parsedArgs?.options ?? [];
  const isWaitingForRequest = toolCall.status === "running" && !questionState;
  const isCancelled =
    questionState?.status === "cancelled" || parsedResult?.cancelled === true;
  const isAnswered =
    questionState?.status === "answered" ||
    Boolean(parsedResult && !parsedResult.cancelled);
  const isSettled = isAnswered || isCancelled;
  const isInteractive = Boolean(questionState && !isSettled);

  const [isOpen, setIsOpen] = useState(true);
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [customAnswers, setCustomAnswers] = useState<string[]>([]);
  const [customInput, setCustomInput] = useState("");

  useEffect(() => {
    setSelectedOptions(
      questionState?.selectedOptions ?? parsedResult?.selectedOptions ?? []
    );
    setCustomAnswers(
      questionState?.customAnswers ?? parsedResult?.customAnswers ?? []
    );
    setCustomInput("");
  }, [
    parsedResult?.customAnswers,
    parsedResult?.selectedOptions,
    questionState?.customAnswers,
    questionState?.questionId,
    questionState?.selectedOptions,
  ]);

  const toggleOption = (option: string): void => {
    if (!isInteractive) {
      return;
    }

    setSelectedOptions((current) =>
      current.includes(option)
        ? current.filter((item) => item !== option)
        : [...current, option]
    );
  };

  const addCustomAnswer = (): void => {
    if (!isInteractive) {
      return;
    }

    const value = customInput.trim();
    if (!value) {
      return;
    }

    setCustomAnswers((current) =>
      current.includes(value) ? current : [...current, value]
    );
    setCustomInput("");
  };

  const removeCustomAnswer = (answer: string): void => {
    if (!isInteractive) {
      return;
    }
    setCustomAnswers((current) => current.filter((item) => item !== answer));
  };

  const pendingCustomAnswer = customInput.trim();
  const canSubmit =
    isInteractive &&
    (selectedOptions.length + customAnswers.length > 0 ||
      Boolean(pendingCustomAnswer));

  const submitAnswer = (): void => {
    if (!questionState || !canSubmit) {
      return;
    }
    answerUserQuestion(
      questionState.questionId,
      selectedOptions,
      pendingCustomAnswer && !customAnswers.includes(pendingCustomAnswer)
        ? [...customAnswers, pendingCustomAnswer]
        : customAnswers
    );
  };

  const cancelAnswer = (): void => {
    if (!questionState || !isInteractive) {
      return;
    }
    cancelUserQuestion(questionState.questionId);
  };

  const statusLabel = isCancelled
    ? t("toolCall.userQuestion.status.cancelled")
    : isAnswered
    ? t("toolCall.userQuestion.status.answered")
    : toolCall.status === "error"
    ? t("toolCall.userQuestion.status.error")
    : t("toolCall.userQuestion.status.waiting");

  return (
    <details
      className="tool-call-item tool-call-user-question"
      open={isOpen}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
    >
      <summary className="tool-call-header">
        <ChevronRight
          className="tool-call-chevron"
          size={14}
          aria-hidden="true"
        />
        <ToolNameBadge
          name={t("toolCall.userQuestion.name")}
          category="interaction"
        />
        {isCancelled ? (
          <X size={14} aria-hidden="true" />
        ) : isAnswered ? (
          <Check size={14} aria-hidden="true" />
        ) : isWaitingForRequest || toolCall.status === "running" ? (
          <Loader2
            className="tool-call-icon-spinning"
            size={14}
            aria-hidden="true"
          />
        ) : (
          <MessageCircleQuestion size={14} aria-hidden="true" />
        )}
        <span className="tool-call-name">
          {t("toolCall.userQuestion.action")}
        </span>
        <span
          className={`tool-call-status tool-call-status-${
            toolCall.status === "error"
              ? "error"
              : isCancelled
              ? "cancelled"
              : isAnswered
              ? "completed"
              : "running"
          }`}
          role="status"
          aria-live="polite"
        >
          {statusLabel}
        </span>
      </summary>

      <div className="tool-call-body tool-call-user-question-body">
        {question ? (
          <div className="tool-call-user-question-heading">
            <MessageCircleQuestion size={16} aria-hidden="true" />
            <strong>{question}</strong>
          </div>
        ) : null}

        {options.length > 0 ? (
          <div
            className="tool-call-user-question-options"
            aria-label={t("toolCall.userQuestion.optionsLabel")}
          >
            {options.map((option) => {
              const isSelected = selectedOptions.includes(option);
              return (
                <label
                  className={`tool-call-user-question-option ${
                    isSelected ? "is-selected" : ""
                  }`}
                  key={option}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    disabled={!isInteractive}
                    onChange={() => toggleOption(option)}
                  />
                  <span>{option}</span>
                </label>
              );
            })}
          </div>
        ) : null}

        <div className="tool-call-user-question-custom">
          <span className="tool-call-user-question-label">
            {t("toolCall.userQuestion.customLabel")}
          </span>
          <form
            className="tool-call-user-question-custom-form"
            onSubmit={(event) => {
              event.preventDefault();
              addCustomAnswer();
            }}
          >
            <input
              type="text"
              value={customInput}
              disabled={!isInteractive}
              placeholder={t("toolCall.userQuestion.customPlaceholder")}
              aria-label={t("toolCall.userQuestion.customLabel")}
              onChange={(event) => setCustomInput(event.target.value)}
            />
            <button
              type="submit"
              disabled={!isInteractive || !customInput.trim()}
              aria-label={t("toolCall.userQuestion.addCustom")}
              title={t("toolCall.userQuestion.addCustom")}
            >
              <Plus size={14} aria-hidden="true" />
            </button>
          </form>

          {customAnswers.length > 0 ? (
            <div className="tool-call-user-question-custom-list">
              {customAnswers.map((answer) => (
                <span
                  className="tool-call-user-question-custom-item"
                  key={answer}
                >
                  <span>{answer}</span>
                  {isInteractive ? (
                    <button
                      type="button"
                      onClick={() => removeCustomAnswer(answer)}
                      aria-label={t("toolCall.userQuestion.removeCustom", {
                        values: { answer },
                      })}
                    >
                      <X size={12} aria-hidden="true" />
                    </button>
                  ) : null}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        {isWaitingForRequest ? (
          <div className="tool-call-user-question-waiting">
            <Loader2
              className="tool-call-icon-spinning"
              size={14}
              aria-hidden="true"
            />
            <span>{t("toolCall.userQuestion.preparing")}</span>
          </div>
        ) : null}

        {toolCall.status === "error" && toolCall.result ? (
          <div className="tool-call-error">
            <span>{toolCall.result}</span>
          </div>
        ) : null}

        <div className="tool-call-user-question-footer">
          <span>
            {isCancelled
              ? t("toolCall.userQuestion.cancelledHint")
              : t("toolCall.userQuestion.multiSelectHint")}
          </span>
          <div className="tool-call-user-question-actions">
            {isInteractive ? (
              <button
                type="button"
                className="tool-call-user-question-cancel"
                onClick={cancelAnswer}
              >
                <X size={14} aria-hidden="true" />
                <span>{t("toolCall.userQuestion.cancel")}</span>
              </button>
            ) : null}
            <button
              type="button"
              className="tool-call-user-question-submit"
              disabled={!canSubmit}
              onClick={submitAnswer}
            >
              {isCancelled ? (
                <X size={14} aria-hidden="true" />
              ) : isAnswered ? (
                <Check size={14} aria-hidden="true" />
              ) : (
                <Send size={14} aria-hidden="true" />
              )}
              <span>
                {isCancelled
                  ? t("toolCall.userQuestion.cancelled")
                  : isAnswered
                  ? t("toolCall.userQuestion.submitted")
                  : t("toolCall.userQuestion.submit")}
              </span>
            </button>
          </div>
        </div>
      </div>
    </details>
  );
};
