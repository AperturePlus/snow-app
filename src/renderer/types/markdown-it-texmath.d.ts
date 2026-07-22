declare module "markdown-it-texmath" {
  import type MarkdownIt from "markdown-it";
  import type katex from "katex";

  interface TexmathOptions {
    /** Rendering engine, pass the katex module. */
    engine?: typeof katex;
    /** Delimiter sets to enable, e.g. "dollars" for $...$ and $$...$$. */
    delimiters?: string | string[];
    /** Options forwarded to katex.renderToString. */
    katexOptions?: katex.KatexOptions;
    /** Require surrounding spaces for inline dollar formulas. */
    outerSpace?: boolean;
    /** KaTeX macros (backwards-compatible shorthand). */
    macros?: Record<string, string>;
  }

  const texmath: MarkdownIt.PluginWithOptions<TexmathOptions>;
  export default texmath;
}
