import MarkdownIt from "markdown-it";
import { ChevronRight } from "lucide-react";
import { useMemo } from "react";
import { AiResponseActions } from "./AiResponseActions";
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
}: AiResponseProps): React.JSX.Element => {
  const normalizedThinking = thinking?.trim();
  const summaryClassName = `ai-message-summary ${
    isStreaming ? "is-streaming" : ""
  }`.trim();

  return (
    <article className="ai-message" aria-label="AI response">
      <div className="ai-message-content">
        {title ? <h2>{title}</h2> : null}
        {normalizedThinking ? (
          <details className="ai-message-thinking">
            <summary>
              <ChevronRight
                className="ai-message-thinking-chevron"
                size={16}
                aria-hidden="true"
              />
              <span>思考过程</span>
            </summary>
            <MarkdownBlock
              className="ai-message-thinking-body"
              content={normalizedThinking}
            />
          </details>
        ) : null}
        <MarkdownBlock className={summaryClassName} content={summary} />
        {sections.map((section) => (
          <section className="ai-message-section" key={section.title}>
            <h3>{section.title}</h3>
            <MarkdownBlock
              className="ai-message-section-body"
              content={section.body}
            />
          </section>
        ))}
      </div>
      <AiResponseActions />
    </article>
  );
};
