import hljs from "highlight.js";
import {
  AlertCircle,
  Code2,
  Copy,
  Eye,
  FileText,
  Image as ImageIcon,
  Loader2,
  Pencil,
  Save,
} from "lucide-react";
import Editor from "react-simple-code-editor";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useI18n } from "../../i18n";
import type { FileContentResult } from "./types";

type FileViewerContentProps = {
  filePath: string;
  fileName: string;
  isSsh: boolean;
  sshSessionId?: string | null;
  onDirtyChange?: (dirty: boolean) => void;
};

const EDITOR_TEXTAREA_ID = "file-viewer-editor-textarea";

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

const isEditable = (content: FileContentResult): boolean =>
  !content.isBinary && !content.isImage;

export function FileViewerContent({
  filePath,
  fileName,
  isSsh,
  sshSessionId,
  onDirtyChange,
}: FileViewerContentProps): React.JSX.Element {
  const { t } = useI18n();
  const [content, setContent] = useState<FileContentResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [svgMode, setSvgMode] = useState<"image" | "code">("image");
  const [copied, setCopied] = useState(false);

  // Edit mode state
  const [editMode, setEditMode] = useState(false);
  const [editedContent, setEditedContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState(false);

  const originalContentRef = useRef("");
  const onDirtyChangeRef = useRef(onDirtyChange);
  const lineNumbersRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    onDirtyChangeRef.current = onDirtyChange;
  }, [onDirtyChange]);

  useEffect(() => {
    onDirtyChangeRef.current?.(dirty);
  }, [dirty]);

  const loadFile = useCallback(async () => {
    setLoading(true);
    setError(null);
    setEditMode(false);
    setDirty(false);
    setSaveError(null);
    setSavedAt(false);
    setEditedContent("");
    try {
      let result: FileContentResult;
      if (isSsh && sshSessionId) {
        result = await window.snow.sshReadFile(sshSessionId, filePath);
      } else {
        result = await window.snow.readFileContent(filePath);
      }
      setContent(result);
      originalContentRef.current = result.content;
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

  const highlightCode = useCallback(
    (code: string): string => {
      const lang = getLanguageFromFileName(fileName);
      if (lang && hljs.getLanguage(lang)) {
        try {
          return hljs.highlight(code, {
            language: lang,
            ignoreIllegals: true,
          }).value;
        } catch {
          return escapeHtml(code);
        }
      }
      return escapeHtml(code);
    },
    [fileName]
  );

  const highlightedCode = useMemo(() => {
    if (!content || content.isImage || content.isBinary)
      return { html: "", lineCount: 0 };
    return {
      html: highlightCode(content.content),
      lineCount: content.content.split("\n").length,
    };
  }, [content, highlightCode]);

  const viewLineNumbers = useMemo(
    () =>
      Array.from({ length: highlightedCode.lineCount }, (_, i) => i + 1).join(
        "\n"
      ),
    [highlightedCode.lineCount]
  );

  const editLineCount = useMemo(
    () => (editMode ? editedContent.split("\n").length : 0),
    [editMode, editedContent]
  );

  const editLineNumbers = useMemo(
    () => Array.from({ length: editLineCount }, (_, i) => i + 1).join("\n"),
    [editLineCount]
  );

  const handleCopy = useCallback(() => {
    if (!content) return;
    navigator.clipboard.writeText(content.content).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  }, [content]);

  const handleEnterEditMode = useCallback(() => {
    if (!content || !isEditable(content)) return;
    setEditMode(true);
    setEditedContent(content.content);
    setDirty(false);
    setSaveError(null);
    setSavedAt(false);
  }, [content]);

  const handleExitEditMode = useCallback(() => {
    if (dirty) {
      const confirmed = window.confirm(
        t("rightPanel.fileViewerDiscardConfirm", {
          defaultValue:
            "You have unsaved changes. Discard them and leave edit mode?",
        })
      );
      if (!confirmed) {
        return;
      }
    }
    setEditMode(false);
    setDirty(false);
    setSaveError(null);
    setSavedAt(false);
    setEditedContent("");
  }, [dirty, t]);

  const handleValueChange = useCallback((next: string) => {
    setEditedContent(next);
    const isDirty = next !== originalContentRef.current;
    setDirty(isDirty);
    if (!isDirty) {
      setSaveError(null);
      setSavedAt(false);
    }
  }, []);

  const handleSave = useCallback(async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setSaveError(null);
    setSavedAt(false);
    try {
      if (isSsh && sshSessionId) {
        await window.snow.sshWriteFile(sshSessionId, filePath, editedContent);
      } else {
        await window.snow.writeFileContent(filePath, editedContent);
      }
      originalContentRef.current = editedContent;
      setDirty(false);
      setSavedAt(true);
      window.setTimeout(() => setSavedAt(false), 2000);
      if (content) {
        setContent({
          ...content,
          content: editedContent,
          size: new Blob([editedContent]).size,
        });
      }
    } catch (err) {
      setSaveError(
        err instanceof Error
          ? err.message
          : t("rightPanel.fileViewerSaveError", {
              defaultValue: "Failed to save file",
            })
      );
    } finally {
      setSaving(false);
    }
  }, [dirty, saving, isSsh, sshSessionId, filePath, editedContent, content, t]);

  // Keyboard shortcuts handled inside the editor's onKeyDown (which runs before
  // the library's own key handling): Ctrl/Cmd+S saves, Esc exits edit mode.
  // Undo/redo (Ctrl/Cmd+Z, Ctrl+Y) is handled natively by the editor library.
  const handleEditorKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        if (dirty && !saving) {
          void handleSave();
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        handleExitEditMode();
      }
    },
    [dirty, saving, handleSave, handleExitEditMode]
  );

  // Focus the editor when entering edit mode, and sync line numbers with the
  // textarea scroll position.
  useEffect(() => {
    if (!editMode) return;
    const textarea = document.getElementById(EDITOR_TEXTAREA_ID);
    if (textarea instanceof HTMLTextAreaElement) {
      textarea.focus();
    }
    const onScroll = () => {
      if (lineNumbersRef.current && textarea) {
        lineNumbersRef.current.scrollTop = textarea.scrollTop;
      }
    };
    textarea?.addEventListener("scroll", onScroll);
    return () => {
      textarea?.removeEventListener("scroll", onScroll);
    };
  }, [editMode, editedContent]);

  const renderCodeBlock = () => {
    const { html } = highlightedCode;
    return (
      <div className="file-viewer-code-scroll">
        <pre className="file-viewer-code">
          <code className="file-viewer-line-numbers" aria-hidden="true">
            {viewLineNumbers}
          </code>
          <code
            className="hljs file-viewer-code-content"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </pre>
      </div>
    );
  };

  const renderEditBlock = () => (
    <div className="file-viewer-edit-scroll">
      <code
        ref={lineNumbersRef}
        className="file-viewer-line-numbers file-viewer-line-numbers--edit"
        aria-hidden="true"
      >
        {editLineNumbers}
      </code>
      <div className="file-viewer-code file-viewer-editor-wrap">
        <Editor
          value={editedContent}
          onValueChange={handleValueChange}
          highlight={highlightCode}
          onKeyDown={handleEditorKeyDown}
          textareaId={EDITOR_TEXTAREA_ID}
          textareaClassName="file-viewer-edit-textarea"
          preClassName="hljs"
          padding={{ top: 12, right: 14, bottom: 12, left: 10 }}
          tabSize={2}
          insertSpaces
          spellCheck={false}
        />
      </div>
    </div>
  );

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
  const canEdit = isEditable(content);

  return (
    <div className="file-viewer">
      <div className="file-viewer-header">
        <span className="file-viewer-file-name" title={filePath}>
          {fileName}
        </span>
        <span className="file-viewer-file-size">
          {formatSize(content.size)}
        </span>
        {editMode ? (
          <span
            className={`file-viewer-edit-status ${dirty ? "dirty" : ""} ${
              savedAt ? "saved" : ""
            }`}
          >
            {dirty
              ? t("rightPanel.fileViewerUnsaved", {
                  defaultValue: "Unsaved",
                })
              : savedAt
              ? t("rightPanel.fileViewerSaved", {
                  defaultValue: "Saved",
                })
              : t("rightPanel.fileViewerEditing", {
                  defaultValue: "Editing",
                })}
          </span>
        ) : null}
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
        {canEdit ? (
          editMode ? (
            <>
              <button
                type="button"
                className="file-viewer-action-btn"
                onClick={handleExitEditMode}
                disabled={saving}
                title={t("rightPanel.fileViewerExitEdit", {
                  defaultValue: "Exit edit mode (Esc)",
                })}
              >
                <Eye size={13} />
              </button>
              <button
                type="button"
                className={`file-viewer-save-btn ${dirty ? "dirty" : ""}`}
                onClick={handleSave}
                disabled={!dirty || saving}
                title={t("rightPanel.fileViewerSave", {
                  defaultValue: "Save (Ctrl+S)",
                })}
              >
                {saving ? (
                  <Loader2 className="spin" size={13} />
                ) : (
                  <Save size={13} />
                )}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="file-viewer-action-btn"
              onClick={handleEnterEditMode}
              title={t("rightPanel.fileViewerEdit", {
                defaultValue: "Edit file",
              })}
            >
              <Pencil size={13} />
            </button>
          )
        ) : null}
      </div>
      {saveError ? (
        <div className="file-viewer-save-error">
          <AlertCircle size={14} />
          <span>{saveError}</span>
        </div>
      ) : null}
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
                defaultValue: "Binary file",
              })}
            </span>
          </div>
        )}
        {!content.isBinary && !isImage && editMode && renderEditBlock()}
        {!content.isBinary && !isImage && !editMode && renderCodeBlock()}
      </div>
    </div>
  );
}
