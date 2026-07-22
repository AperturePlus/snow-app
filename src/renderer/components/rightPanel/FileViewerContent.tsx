import hljs from "highlight.js";
import {
  AlertCircle,
  Code2,
  Copy,
  FileText,
  Image as ImageIcon,
  Loader2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useI18n } from "../../i18n";
import type { FileContentResult } from "./types";

type FileViewerContentProps = {
  filePath: string;
  fileName: string;
  isSsh: boolean;
  sshSessionId?: string | null;
};

const escapeHtml = (str: string): string =>
  str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const getLanguageFromFileName = (fileName: string): string => {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    json: "json",
    css: "css",
    scss: "scss",
    less: "less",
    html: "xml",
    htm: "xml",
    xml: "xml",
    svg: "xml",
    md: "markdown",
    markdown: "markdown",
    py: "python",
    rb: "ruby",
    go: "go",
    rs: "rust",
    java: "java",
    kt: "kotlin",
    swift: "swift",
    c: "c",
    h: "c",
    cpp: "cpp",
    cc: "cpp",
    cxx: "cpp",
    hpp: "cpp",
    cs: "csharp",
    php: "php",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    yml: "yaml",
    yaml: "yaml",
    toml: "ini",
    ini: "ini",
    cfg: "ini",
    sql: "sql",
    graphql: "graphql",
    gql: "graphql",
    lua: "lua",
    r: "r",
    dart: "dart",
    vue: "xml",
    svelte: "xml",
    dockerfile: "dockerfile",
    makefile: "makefile",
    diff: "diff",
    patch: "diff",
  };
  return map[ext] ?? "";
};

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export function FileViewerContent({
  filePath,
  fileName,
  isSsh,
  sshSessionId,
}: FileViewerContentProps): React.JSX.Element {
  const { t } = useI18n();
  const [content, setContent] = useState<FileContentResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [svgMode, setSvgMode] = useState<"image" | "code">("image");
  const [copied, setCopied] = useState(false);

  const loadFile = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let result: FileContentResult;
      if (isSsh && sshSessionId) {
        result = await window.snow.sshReadFile(sshSessionId, filePath);
      } else {
        result = await window.snow.readFileContent(filePath);
      }
      setContent(result);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("rightPanel.fileViewerLoadError", {
              defaultValue: "Failed to load file",
            })
      );
    } finally {
      setLoading(false);
    }
  }, [filePath, isSsh, sshSessionId, t]);

  useEffect(() => {
    void loadFile();
  }, [loadFile]);

  const highlightedCode = useMemo(() => {
    if (!content || content.isImage || content.isBinary)
      return { html: "", lineCount: 0 };
    const lang = getLanguageFromFileName(fileName);
    const lineCount = content.content.split("\n").length;
    if (lang && hljs.getLanguage(lang)) {
      try {
        const html = hljs.highlight(content.content, {
          language: lang,
          ignoreIllegals: true,
        }).value;
        return { html, lineCount };
      } catch {
        return { html: escapeHtml(content.content), lineCount };
      }
    }
    return { html: escapeHtml(content.content), lineCount };
  }, [content, fileName]);

  const handleCopy = useCallback(() => {
    if (!content) return;
    navigator.clipboard.writeText(content.content).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  }, [content]);

  const renderCodeBlock = () => {
    const { html, lineCount } = highlightedCode;
    const lineNumbers = Array.from({ length: lineCount }, (_, i) => i + 1).join(
      "\n"
    );
    return (
      <div className="file-viewer-code-scroll">
        <pre className="file-viewer-code">
          <code className="file-viewer-line-numbers" aria-hidden="true">
            {lineNumbers}
          </code>
          <code
            className="hljs file-viewer-code-content"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </pre>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="file-viewer">
        <div className="file-viewer-header">
          <span className="file-viewer-file-name" title={filePath}>
            {fileName}
          </span>
        </div>
        <div className="file-viewer-loading">
          <Loader2 className="spin" size={20} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="file-viewer">
        <div className="file-viewer-header">
          <span className="file-viewer-file-name" title={filePath}>
            {fileName}
          </span>
        </div>
        <div className="file-viewer-error">
          <AlertCircle size={20} />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  if (!content) {
    return (
      <div className="file-viewer">
        <div className="file-viewer-header">
          <span className="file-viewer-file-name" title={filePath}>
            {fileName}
          </span>
        </div>
        <div className="file-viewer-empty">
          <FileText size={20} />
          <span>
            {t("rightPanel.fileViewerEmpty", {
              defaultValue: "No content to display",
            })}
          </span>
        </div>
      </div>
    );
  }

  const isSvg = content.isSvg;
  const isImage = content.isImage;
  const isBinary = content.isBinary && !isImage;

  return (
    <div className="file-viewer">
      <div className="file-viewer-header">
        <span className="file-viewer-file-name" title={filePath}>
          {fileName}
        </span>
        <span className="file-viewer-file-size">
          {formatSize(content.size)}
        </span>
        {isSvg && (
          <div className="file-viewer-svg-toggle">
            <button
              type="button"
              className={`file-viewer-toggle-btn ${
                svgMode === "image" ? "active" : ""
              }`}
              onClick={() => setSvgMode("image")}
              title={t("rightPanel.svgImageMode", {
                defaultValue: "View as image",
              })}
            >
              <ImageIcon size={13} />
            </button>
            <button
              type="button"
              className={`file-viewer-toggle-btn ${
                svgMode === "code" ? "active" : ""
              }`}
              onClick={() => setSvgMode("code")}
              title={t("rightPanel.svgCodeMode", {
                defaultValue: "View as code",
              })}
            >
              <Code2 size={13} />
            </button>
          </div>
        )}
        {!content.isBinary && (
          <button
            type="button"
            className={`file-viewer-copy-btn ${copied ? "copied" : ""}`}
            onClick={handleCopy}
            title={t("rightPanel.copy", { defaultValue: "Copy" })}
          >
            <Copy size={13} />
          </button>
        )}
      </div>
      <div className="file-viewer-body">
        {isImage && !isSvg && (
          <div className="file-viewer-image-container">
            <img
              src={`data:${content.mimeType};base64,${content.content}`}
              alt={fileName}
              className="file-viewer-image"
            />
          </div>
        )}
        {isSvg && svgMode === "image" && (
          <div className="file-viewer-image-container">
            <img
              src={`data:image/svg+xml;utf8,${encodeURIComponent(
                content.content
              )}`}
              alt={fileName}
              className="file-viewer-image"
            />
          </div>
        )}
        {isSvg && svgMode === "code" && renderCodeBlock()}
        {isBinary && (
          <div className="file-viewer-binary">
            <ImageIcon size={32} />
            <span>
              {t("rightPanel.binaryFile", {
                defaultValue: "Binary file not displayed",
              })}
            </span>
          </div>
        )}
        {!content.isBinary && !isImage && renderCodeBlock()}
      </div>
    </div>
  );
}
