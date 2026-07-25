import {
  getChangeIconHtml,
  getCommitIconHtml,
  getFileTypeIconHtml,
} from "../../../utils/fileIcons";

export type FileTag = {
  path: string;
  name: string;
  isDirectory: boolean;
};

export type ImageTag = {
  name: string;
  dataUrl: string;
  index?: number;
};

export type CommitTag = {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  message: string;
  repoPath: string;
};

export type ChangeTag = {
  repoPath: string;
  path: string;
  section: "staged" | "unstaged";
  status: string;
};

export type ContentSegment =
  | { type: "text"; content: string }
  | { type: "file"; tag: FileTag }
  | { type: "image"; tag: ImageTag }
  | { type: "commit"; tag: CommitTag }
  | { type: "change"; tag: ChangeTag };

export const encodeFileTag = (tag: FileTag): string =>
  `@@${tag.isDirectory ? "dir" : "file"}:${tag.path}@@`;

export const encodeImageTag = (tag: ImageTag): string =>
  `@@image:${tag.dataUrl}@@`;

export const encodeCommitTag = (tag: CommitTag): string =>
  `@@commit:${JSON.stringify({
    hash: tag.hash,
    shortHash: tag.shortHash,
    author: tag.author,
    date: tag.date,
    message: tag.message,
    repoPath: tag.repoPath,
  })}@@`;

export const encodeChangeTag = (tag: ChangeTag): string =>
  `@@change:${JSON.stringify({
    repoPath: tag.repoPath,
    path: tag.path,
    section: tag.section,
    status: tag.status,
  })}@@`;

export const parseContentSegments = (content: string): ContentSegment[] => {
  const segments: ContentSegment[] = [];
  const regex = /@@(file|dir|image|commit|change):(.+?)@@/g;
  let lastIndex = 0;
  let imageCounter = 0;
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

    if (kind === "commit") {
      try {
        const data = JSON.parse(value) as Partial<CommitTag>;
        segments.push({
          type: "commit",
          tag: {
            hash: data.hash ?? "",
            shortHash: data.shortHash ?? "",
            author: data.author ?? "",
            date: data.date ?? "",
            message: data.message ?? "",
            repoPath: data.repoPath ?? "",
          },
        });
      } catch {
        segments.push({ type: "text", content: match[0] });
      }
    } else if (kind === "change") {
      try {
        const data = JSON.parse(value) as Partial<ChangeTag>;
        segments.push({
          type: "change",
          tag: {
            repoPath: data.repoPath ?? "",
            path: data.path ?? "",
            section: data.section === "staged" ? "staged" : "unstaged",
            status: data.status ?? "",
          },
        });
      } catch {
        segments.push({ type: "text", content: match[0] });
      }
    } else if (kind === "image") {
      imageCounter += 1;
      // 图片统一显示为 image.<ext>，避免磁盘存储路径里冗长的文件名
      // （带 hash/时间戳）污染 chip 标签。扩展名从 data URL 或路径推断。
      const ext = (() => {
        const mimeMatch = value.match(/^data:image\/([a-z]+);/);
        if (mimeMatch) {
          return mimeMatch[1];
        }
        const pathExtMatch = value.match(/\.([a-zA-Z0-9]+)(?:[?#]|$)/);
        return pathExtMatch ? pathExtMatch[1].toLowerCase() : "png";
      })();
      segments.push({
        type: "image",
        tag: {
          name: `image.${ext}`,
          dataUrl: value,
          index: imageCounter,
        },
      });
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
  const indexSuffix =
    typeof tag.index === "number" && tag.index > 0 ? ` #${tag.index}` : "";
  return `<span class="file-chip image-chip" contenteditable="false" data-image-tag="true" data-image-name="${escapeHtml(
    tag.name
  )}" data-image-data-url="${escapeHtml(
    tag.dataUrl
  )}"><span class="file-chip-icon">${icon}</span><span class="file-chip-name">${escapeHtml(
    `${tag.name}${indexSuffix}`
  )}</span><span class="file-chip-remove" data-chip-remove="true">${CLOSE_ICON_SVG}</span></span>`;
};

export const createCommitChipHtml = (tag: CommitTag): string => {
  const icon = getCommitIconHtml(12);
  const chipTitle = `${tag.shortHash} ${tag.message} (${tag.author}, ${tag.date})`;
  const commitData = escapeHtml(
    JSON.stringify({
      hash: tag.hash,
      shortHash: tag.shortHash,
      author: tag.author,
      date: tag.date,
      message: tag.message,
      repoPath: tag.repoPath,
    })
  );
  return `<span class="file-chip commit-chip" contenteditable="false" data-commit-tag="true" data-commit-data="${commitData}" title="${escapeHtml(
    chipTitle
  )}"><span class="file-chip-icon">${icon}</span><span class="file-chip-name">${escapeHtml(
    tag.shortHash
  )}</span><span class="file-chip-remove" data-chip-remove="true">${CLOSE_ICON_SVG}</span></span>`;
};

export const createChangeChipHtml = (tag: ChangeTag): string => {
  const icon = getChangeIconHtml(12);
  const lastSep = Math.max(
    tag.path.lastIndexOf("/"),
    tag.path.lastIndexOf("\\")
  );
  const name = lastSep === -1 ? tag.path : tag.path.slice(lastSep + 1);
  const chipTitle = `${tag.section === "staged" ? "Staged" : "Unstaged"} ${tag.status} ${tag.path}`;
  const changeData = escapeHtml(
    JSON.stringify({
      repoPath: tag.repoPath,
      path: tag.path,
      section: tag.section,
      status: tag.status,
    })
  );
  return `<span class="file-chip change-chip" contenteditable="false" data-change-tag="true" data-change-data="${changeData}" title="${escapeHtml(
    chipTitle
  )}"><span class="file-chip-icon">${icon}</span><span class="file-chip-name">${escapeHtml(
    name
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
          name: elem.dataset.imageName || "image.png",
          dataUrl: elem.dataset.imageDataUrl || "",
        });
      } else if (elem.dataset.commitTag === "true") {
        try {
          const data = JSON.parse(
            elem.dataset.commitData || "{}"
          ) as Partial<CommitTag>;
          result += encodeCommitTag({
            hash: data.hash ?? "",
            shortHash: data.shortHash ?? "",
            author: data.author ?? "",
            date: data.date ?? "",
            message: data.message ?? "",
            repoPath: data.repoPath ?? "",
          });
        } catch {
          // Ignore malformed commit data
        }
      } else if (elem.dataset.changeTag === "true") {
        try {
          const data = JSON.parse(
            elem.dataset.changeData || "{}"
          ) as Partial<ChangeTag>;
          result += encodeChangeTag({
            repoPath: data.repoPath ?? "",
            path: data.path ?? "",
            section: data.section === "staged" ? "staged" : "unstaged",
            status: data.status ?? "",
          });
        } catch {
          // Ignore malformed change data
        }
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

/**
 * 重新编号编辑区内的图片 chip，并固定所有 chip 的宽度。
 *
 * 固定宽度的目的：chip 内的 remove 按钮默认隐藏，hover 时才显示。
 * 若不固定宽度，hover 出现按钮会撑大 chip，导致名字不省略、布局跳动。
 * 固定后，hover 时名字用省略号收缩让位，chip 外框尺寸不变。
 *
 * 测量时需要临时释放 name 元素的 `flex: 1` + `min-width: 0`，否则
 * inline-flex chip 会把名字收缩到接近 0，从而钉住一个过小的宽度，
 * 导致大部分文件名被截断。释放后 chip 展开到完整内容宽度，再复原样式。
 *
 * 此逻辑在输入框内容变化（syncContent）和草稿还原（draftToRestore）
 * 两个场景都需要调用，因此提取为独立工具函数。
 */
export const renumberImageChips = (el: HTMLElement): void => {
  const chips = el.querySelectorAll<HTMLElement>("[data-image-tag='true']");
  chips.forEach((chip, i) => {
    const index = i + 1;
    const name = chip.dataset.imageName || "";
    const nameEl = chip.querySelector<HTMLElement>(".file-chip-name");
    if (nameEl) {
      nameEl.textContent = `${name} #${index}`;
    }
    chip.dataset.imageIndex = String(index);
  });

  const allChips = el.querySelectorAll<HTMLElement>(".file-chip");
  allChips.forEach((chip) => {
    const removeEl = chip.querySelector<HTMLElement>(".file-chip-remove");
    const nameEl = chip.querySelector<HTMLElement>(".file-chip-name");

    const prevRemoveDisplay = removeEl ? removeEl.style.display : "";
    const prevNameFlex = nameEl ? nameEl.style.flex : "";
    const prevNameMinWidth = nameEl ? nameEl.style.minWidth : "";

    if (removeEl) {
      removeEl.style.display = "none";
    }
    if (nameEl) {
      nameEl.style.flex = "0 0 auto";
      nameEl.style.minWidth = "";
    }
    chip.style.width = "";
    const naturalWidth = chip.offsetWidth;

    if (removeEl) {
      removeEl.style.display = prevRemoveDisplay;
    }
    if (nameEl) {
      nameEl.style.flex = prevNameFlex;
      nameEl.style.minWidth = prevNameMinWidth;
    }
    chip.style.width = `${naturalWidth}px`;
  });
};
