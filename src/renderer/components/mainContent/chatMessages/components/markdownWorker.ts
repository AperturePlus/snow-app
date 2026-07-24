/**
 * Markdown rendering Web Worker.
 *
 * Runs markdown-it + highlight.js off the main thread so that streaming
 * chunk bursts from the AI loop no longer jank the UI. The worker keeps a
 * small LRU cache keyed by content hash so that repeated renders (e.g. a
 * finalized message re-rendered after re-entering a conversation) are free.
 *
 * The worker is intentionally framework-agnostic: it receives a plain
 * { id, content } message and replies with { id, html }. The React layer
 * is responsible for throttling and dispatching.
 */

import hljs from "highlight.js";
import katex from "katex";
import MarkdownIt from "markdown-it";
import texmath from "markdown-it-texmath";

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

    // Mermaid diagrams are rendered on the main thread (mermaid needs DOM
    // access and cannot run inside a Web Worker). Emit a placeholder container
    // carrying the escaped source. The structure includes:
    //   - a toolbar with copy + view-toggle buttons (handled in the React layer)
    //   - a code view (highlighted source, visible by default during streaming)
    //   - an empty diagram view (filled with SVG by mermaidRenderer once parsed)
    // `data-mermaid-view="code"` keeps the code visible until the diagram is
    // ready, preventing flicker while incomplete code is streaming in.
    if (language === "mermaid") {
      const encoded = encodeURIComponent(str);
      const highlighted = escapeHtml(str);
      return (
        `<div class="mermaid-block" data-mermaid="${encoded}" data-mermaid-view="code">` +
        `<div class="mermaid-toolbar">` +
        `<span class="mermaid-toolbar-label">mermaid</span>` +
        `<div class="mermaid-toolbar-actions">` +
        `<button class="mermaid-btn-copy" type="button" data-code="${encoded}" title="Copy">` +
        `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>` +
        `</button>` +
        `<button class="mermaid-btn-download" type="button" data-mermaid-action="download" title="Save as image">` +
        `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>` +
        `</button>` +
        `<button class="mermaid-btn-code" type="button" data-mermaid-action="code" title="Code view">` +
        `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>` +
        `</button>` +
        `<button class="mermaid-btn-diagram" type="button" data-mermaid-action="diagram" title="Diagram view">` +
        `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="M3 9h6"/></svg>` +
        `</button>` +
        `</div>` +
        `</div>` +
        `<div class="mermaid-view-code"><pre><code class="hljs language-mermaid">${highlighted}</code></pre></div>` +
        `<div class="mermaid-view-diagram"></div>` +
        `</div>`
      );
    }

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

// The highlight callback above returns a complete .code-block-wrapper element.
// markdown-it's default fence renderer would nest any highlight result that
// does not start with "<pre" inside an extra <pre><code>, producing invalid
// HTML (<div> inside inline <code>) whose empty inline fragments render as
// stray gray bars around the code block. Return the wrapper directly instead.
markdown.renderer.rules.fence = (tokens, idx, options): string => {
  const token = tokens[idx];
  const lang = token.info ? token.info.trim() : "";
  const rendered = options.highlight
    ? options.highlight(token.content, lang, "")
    : "";
  return (
    (rendered || `<pre><code>${escapeHtml(token.content)}</code></pre>`) + "\n"
  );
};

// Wrap tables in a scrollable container so that wide tables are horizontally
// scrollable instead of being clipped by overflow:hidden on the table element.
markdown.renderer.rules.table_open = (): string =>
  '<div class="table-wrapper">\n<table>\n';
markdown.renderer.rules.table_close = (): string => "</table>\n</div>\n";

/**
 * KaTeX math rendering. texmath parses `$...$` inline and `$$...$$` display
 * formulas and delegates to katex.renderToString, which is pure string work
 * and therefore safe inside a Web Worker. throwOnError is disabled so that a
 * half-typed formula during streaming renders as highlighted source instead
 * of throwing and breaking the whole render pass.
 */
markdown.use(texmath, {
  engine: katex,
  delimiters: "dollars",
  katexOptions: { throwOnError: false },
});

/**
 * Tiny LRU cache for rendered HTML. Keyed by content string. We cap the
 * number of entries (not byte size) — markdown HTML for chat messages is
 * small enough that 64 entries cover the visible viewport comfortably,
 * and evicting older entries keeps memory bounded across long sessions.
 *
 * The cache lives in the worker (not the main thread) so that:
 *   - The same worker instance is reused across all MarkdownBlock instances.
 *   - Cache lookups do not require a structured-clone round-trip.
 */
const CACHE_MAX_ENTRIES = 64;
const renderCache = new Map<string, string>();

const cacheGet = (key: string): string | undefined => {
  const value = renderCache.get(key);
  if (value !== undefined) {
    // Move to most-recently-used position (Map preserves insertion order).
    renderCache.delete(key);
    renderCache.set(key, value);
  }
  return value;
};

const cacheSet = (key: string, value: string): void => {
  if (renderCache.size >= CACHE_MAX_ENTRIES) {
    // Evict the oldest entry (first key of the Map).
    const oldestKey = renderCache.keys().next().value;
    if (oldestKey !== undefined) {
      renderCache.delete(oldestKey);
    }
  }
  renderCache.set(key, value);
};

export type MarkdownRenderRequest = {
  /** Correlates the response with the request that triggered it. */
  id: number;
  content: string;
};

export type MarkdownRenderResponse = {
  id: number;
  html: string;
};

const render = (content: string): string => {
  const cached = cacheGet(content);
  if (cached !== undefined) {
    return cached;
  }
  const html = markdown.render(content);
  cacheSet(content, html);
  return html;
};

// Self-listener keeps the worker framework-agnostic and type-safe even when
// `self` is the global worker scope (no DOM `window` available).
self.onmessage = (event: MessageEvent<MarkdownRenderRequest>): void => {
  const { id, content } = event.data;
  const html = render(content);
  const response: MarkdownRenderResponse = { id, html };
  (self as unknown as Worker).postMessage(response);
};
