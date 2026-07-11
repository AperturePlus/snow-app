import { getFileTypeIconHtml } from "../../../utils/fileIcons";

export type FileTag = {
  path: string;
  name: string;
  isDirectory: boolean;
};

export type ImageTag = {
  name: string;
  dataUrl: string;
};

export type ContentSegment =
  | { type: "text"; content: string }
  | { type: "file"; tag: FileTag }
  | { type: "image"; tag: ImageTag };

export const encodeFileTag = (tag: FileTag): string =>
  `@@${tag.isDirectory ? "dir" : "file"}:${tag.path}@@`;

export const encodeImageTag = (tag: ImageTag): string =>
  `@@image:${tag.dataUrl}@@`;

export const parseContentSegments = (content: string): ContentSegment[] => {
  const segments: ContentSegment[] = [];
  const regex = /@@(file|dir|image):(.+?)@@/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        type: "text",
        content: content.slice(lastIndex, match.index),
      });
    }
    const kind = match[1];
    const value = match[2];

    if (kind === "image") {
      if (value.startsWith("data:image/")) {
        const mimeMatch = value.match(/^data:image\/([a-z]+);/);
        const ext = mimeMatch ? mimeMatch[1] : "png";
        segments.push({
          type: "image",
          tag: { name: `image.${ext}`, dataUrl: value },
        });
      } else {
        const name = value.split("/").filter(Boolean).pop() || "image.png";
        segments.push({ type: "image", tag: { name, dataUrl: value } });
      }
    } else {
      const isDirectory = kind === "dir";
      const path = value;
      const name = path.split(/[\\/]/).filter(Boolean).pop() || path;
      segments.push({ type: "file", tag: { path, name, isDirectory } });
    }
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

const CLOSE_ICON_SVG =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

export const createChipHtml = (tag: FileTag): string => {
  const icon = getFileTypeIconHtml(tag.name, tag.isDirectory, false, 12);
  return `<span class="file-chip" contenteditable="false" data-file-tag="true" data-file-path="${escapeHtml(
    tag.path
  )}" data-file-name="${escapeHtml(tag.name)}" data-file-is-dir="${
    tag.isDirectory
  }" title="${escapeHtml(
    tag.path
  )}"><span class="file-chip-icon">${icon}</span><span class="file-chip-name">${escapeHtml(
    tag.name
  )}</span><span class="file-chip-remove" data-chip-remove="true">${CLOSE_ICON_SVG}</span></span>`;
};

export const createImageChipHtml = (tag: ImageTag): string => {
  const icon = getFileTypeIconHtml(tag.name, false, false, 12);
  return `<span class="file-chip image-chip" contenteditable="false" data-image-tag="true" data-image-data-url="${escapeHtml(
    tag.dataUrl
  )}"><span class="file-chip-icon">${icon}</span><span class="file-chip-name">${escapeHtml(
    tag.name
  )}</span><span class="file-chip-remove" data-chip-remove="true">${CLOSE_ICON_SVG}</span></span>`;
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
      } else if (elem.dataset.imageTag === "true") {
        result += encodeImageTag({
          name:
            elem.querySelector(".file-chip-name")?.textContent || "image.png",
          dataUrl: elem.dataset.imageDataUrl || "",
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
