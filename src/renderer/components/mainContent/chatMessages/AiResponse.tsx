import { Loader2 } from "lucide-react";
import { useI18n } from "../../../i18n";
import { AiResponseActions } from "./AiResponseActions";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolCallItem } from "./ToolCallItem";
import { MarkdownBlock } from "./markdownRenderer";
import type { AiResponseProps } from "./types";

export const AiResponse = ({
  title,
  summary,
  thinking,
  sections = [],
  isStreaming = false,
  isAborting = false,
  showActions = true,
  toolCalls = [],
}: AiResponseProps): React.JSX.Element => {
  const { t } = useI18n();
  const normalizedThinking = thinking?.trim();
  const normalizedSummary = summary.trim();
  const summaryClassName = "ai-message-summary";
  const hasToolCalls = toolCalls.length > 0;

  return (
    <article className="ai-message" aria-label="AI response">
      <div className="ai-message-content">
        {title ? <h2>{title}</h2> : null}

        {/* 1. Thinking */}
        {normalizedThinking ? (
          <ThinkingBlock
            content={normalizedThinking}
            isStreaming={isStreaming}
          />
        ) : null}

        {/* 2. Body / Summary */}
        {normalizedSummary ? (
          <MarkdownBlock
            className={summaryClassName}
            content={normalizedSummary}
          />
        ) : null}

        {/* 3. Sections */}
        {sections.map((section) => (
          <section className="ai-message-section" key={section.title}>
            <h3>{section.title}</h3>
            <MarkdownBlock
              className="ai-message-section-body"
              content={section.body}
            />
          </section>
        ))}

        {/* 4. Tool calls */}
        {hasToolCalls ? (
          <div className="tool-calls-container">
            {toolCalls.map((toolCall, index) => (
              <ToolCallItem
                key={`${toolCall.name}-${index}`}
                toolCall={toolCall}
              />
            ))}
          </div>
        ) : null}

        {/* 5. Loading indicator — persists throughout the entire AI loop */}
        {isAborting ? (
          <span className="stream-stopping">
            <Loader2 size={12} className="spin" />
            <span>{t("chat.stopping", { defaultValue: "Stopping..." })}</span>
          </span>
        ) : isStreaming ? (
          <span className="stream-cursor" aria-hidden="true" />
        ) : null}
      </div>

      {/* 6. Actions */}
      {showActions ? <AiResponseActions /> : null}
    </article>
  );
};
