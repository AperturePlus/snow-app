import MarkdownIt from "markdown-it";
import { ChevronRight } from "lucide-react";
import { useMemo } from "react";
import { useI18n } from "../../../i18n";
import { AiResponseActions } from "./AiResponseActions";
import { ToolCallItem } from "./ToolCallItem";
import type { AiResponseProps } from "./types";

const markdown = new MarkdownIt({
  breaks: true,
  html: false,
  linkify: true,
});

const MarkdownBlock = ({
  className,
  content,
}: {
  className: string;
  content: string;
}): React.JSX.Element => {
  const html = useMemo(() => markdown.render(content), [content]);

  return (
    <div className={className} dangerouslySetInnerHTML={{ __html: html }} />
  );
};

export const AiResponse = ({
  title,
  summary,
  thinking,
  sections = [],
  isStreaming = false,
  showActions = true,
  toolCalls = [],
}: AiResponseProps): React.JSX.Element => {
  const { t } = useI18n();
  const normalizedThinking = thinking?.trim();
  const normalizedSummary = summary.trim();
  const summaryClassName = `ai-message-summary ${
    isStreaming ? "is-streaming" : ""
  }`.trim();
  const hasToolCalls = toolCalls.length > 0;
  const isEmpty = !normalizedThinking && !normalizedSummary && !hasToolCalls;

  return (
    <article className="ai-message" aria-label="AI response">
      <div className="ai-message-content">
        {title ? <h2>{title}</h2> : null}

        {/* 1. Thinking */}
        {normalizedThinking ? (
          <details className="ai-message-thinking">
            <summary>
              <ChevronRight
                className="ai-message-thinking-chevron"
                size={16}
                aria-hidden="true"
              />
              <span>{t("chat.thinkingProcess")}</span>
            </summary>
            <MarkdownBlock
              className="ai-message-thinking-body"
              content={normalizedThinking}
            />
          </details>
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

        {/* 5. Loading indicator when streaming with no content yet */}
        {isEmpty && isStreaming ? (
          <span className="stream-cursor" aria-hidden="true" />
        ) : null}
      </div>

      {/* 6. Actions */}
      {showActions ? <AiResponseActions /> : null}
    </article>
  );
};
