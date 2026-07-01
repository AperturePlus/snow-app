import hljs from "highlight.js";
import MarkdownIt from "markdown-it";
import { ChevronRight, Loader2 } from "lucide-react";
import { useCallback, useMemo } from "react";
import { useI18n } from "../../../i18n";
import { AiResponseActions } from "./AiResponseActions";
import { ToolCallItem } from "./ToolCallItem";
import type { AiResponseProps } from "./types";

/**
 * Escape HTML special characters in a string so that when highlight.js
 * returns autoHighlight for an unknown language the result is safe to inject.
 */
const escapeHtml = (str: string): string =>
  str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const markdown = new MarkdownIt({
  breaks: true,
  html: false,
  linkify: true,
  highlight(str: string, lang: string): string {
    const language = lang?.trim();
    let highlighted: string;

    if (language && hljs.getLanguage(language)) {
      try {
        highlighted = hljs.highlight(str, {
          language,
          ignoreIllegals: true,
        }).value;
      } catch {
        highlighted = escapeHtml(str);
      }
    } else {
      highlighted = escapeHtml(str);
    }

    const label = language || "code";

    return (
      `<div class="code-block-wrapper">` +
      `<div class="code-block-header">` +
      `<button class="code-block-lang" type="button">` +
      `<svg class="code-block-chevron" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>` +
      `<span>${label}</span>` +
      `</button>` +
      `<button class="code-block-copy" type="button" data-code="${encodeURIComponent(
        str
      )}">` +
      `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>` +
      `</button>` +
      `</div>` +
      `<pre><code class="hljs language-${
        language || ""
      }">${highlighted}</code></pre>` +
      `</div>`
    );
  },
});

const MarkdownBlock = ({
  className,
  content,
}: {
  className: string;
  content: string;
}): React.JSX.Element => {
  const html = useMemo(() => markdown.render(content), [content]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;

    // Handle collapse / expand toggle
    const langBtn = target.closest(".code-block-lang") as HTMLElement | null;
    if (langBtn) {
      const wrapper = langBtn.closest(".code-block-wrapper");
      if (wrapper) {
        wrapper.classList.toggle("collapsed");
      }
      return;
    }

    // Handle copy button
    const copyBtn = target.closest(".code-block-copy") as HTMLElement | null;
    if (!copyBtn) return;

    const raw = copyBtn.dataset.code;
    if (!raw) return;

    const code = decodeURIComponent(raw);
    navigator.clipboard.writeText(code).then(() => {
      copyBtn.classList.add("copied");
      window.setTimeout(() => copyBtn.classList.remove("copied"), 2000);
    });
  }, []);

  return (
    <div
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={handleClick}
    />
  );
};

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
