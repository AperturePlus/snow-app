import hljs from "highlight.js";
import MarkdownIt from "markdown-it";
import { useCallback, useMemo } from "react";

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

export const MarkdownBlock = ({
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
