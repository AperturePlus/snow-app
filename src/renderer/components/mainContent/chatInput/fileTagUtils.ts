export type FileTag = {
  path: string;
  name: string;
  isDirectory: boolean;
};

export type ContentSegment =
  | { type: "text"; content: string }
  | { type: "file"; tag: FileTag };

export const encodeFileTag = (tag: FileTag): string =>
  `@@${tag.isDirectory ? "dir" : "file"}:${tag.path}@@`;

export const parseContentSegments = (content: string): ContentSegment[] => {
  const segments: ContentSegment[] = [];
  const regex = /@@(file|dir):(.+?)@@/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        type: "text",
        content: content.slice(lastIndex, match.index),
      });
    }
    const isDirectory = match[1] === "dir";
    const path = match[2];
    const name = path.split("/").filter(Boolean).pop() || path;
    segments.push({ type: "file", tag: { path, name, isDirectory } });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < content.length) {
    segments.push({ type: "text", content: content.slice(lastIndex) });
  }

  return segments;
};

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const FILE_ICON_SVG =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8.5z"/><path d="M14 3v5h5"/></svg>';

const FOLDER_ICON_SVG =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2z"/></svg>';

export const createChipHtml = (tag: FileTag): string => {
  const icon = tag.isDirectory ? FOLDER_ICON_SVG : FILE_ICON_SVG;
  return `<span class="file-chip" contenteditable="false" data-file-tag="true" data-file-path="${escapeHtml(
    tag.path
  )}" data-file-name="${escapeHtml(
    tag.name
  )}" data-file-is-dir="${tag.isDirectory}"><span class="file-chip-icon">${icon}</span><span class="file-chip-name">${escapeHtml(
    tag.name
  )}</span></span>`;
};

export const readEditableContent = (el: HTMLElement): string => {
  let result = "";
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      result += (node.textContent || "").replace(/\u200B/g, "");
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const elem = node as HTMLElement;
      if (elem.dataset.fileTag === "true") {
        result += encodeFileTag({
          path: elem.dataset.filePath || "",
          name: elem.dataset.fileName || "",
          isDirectory: elem.dataset.fileIsDir === "true",
        });
      } else if (elem.tagName === "BR") {
        result += "\n";
      } else {
        const isBlock = elem.tagName === "DIV" || elem.tagName === "P";
        if (isBlock && result.length > 0 && !result.endsWith("\n")) {
          result += "\n";
        }
        elem.childNodes.forEach(walk);
      }
    }
  };
  el.childNodes.forEach(walk);
  return result;
};

export const insertHtmlAtSelection = (html: string): void => {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) {
    return;
  }

  const range = selection.getRangeAt(0);
  range.deleteContents();

  const fragment = range.createContextualFragment(html);
  const lastNode = fragment.lastChild;
  range.insertNode(fragment);

  if (lastNode) {
    const space = document.createTextNode(" ");
    lastNode.parentNode?.insertBefore(space, lastNode.nextSibling);

    range.setStartAfter(space);
    range.setEndAfter(space);
    selection.removeAllRanges();
    selection.addRange(range);
  }
};
