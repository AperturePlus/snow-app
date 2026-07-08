import { extname } from "node:path";

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "bmp",
  "webp",
  "ico",
  "svg",
]);

const MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  webp: "image/webp",
  ico: "image/x-icon",
  svg: "image/svg+xml",
};

export type FileContentResult = {
  content: string;
  isBinary: boolean;
  isImage: boolean;
  isSvg: boolean;
  mimeType: string;
  encoding: "utf8" | "base64";
  size: number;
};

export const processFileContent = (
  filePath: string,
  buffer: Buffer
): FileContentResult => {
  const ext = extname(filePath).slice(1).toLowerCase();
  const isSvg = ext === "svg";
  const isImage = IMAGE_EXTENSIONS.has(ext);
  const size = buffer.length;

  if (isSvg) {
    return {
      content: buffer.toString("utf8"),
      isBinary: false,
      isImage: true,
      isSvg: true,
      mimeType: "image/svg+xml",
      encoding: "utf8",
      size,
    };
  }

  if (isImage) {
    return {
      content: buffer.toString("base64"),
      isBinary: true,
      isImage: true,
      isSvg: false,
      mimeType: MIME_TYPES[ext] ?? "application/octet-stream",
      encoding: "base64",
      size,
    };
  }

  const checkLength = Math.min(buffer.length, 8192);
  let isBinary = false;
  for (let i = 0; i < checkLength; i++) {
    if (buffer[i] === 0) {
      isBinary = true;
      break;
    }
  }

  if (isBinary) {
    return {
      content: buffer.toString("base64"),
      isBinary: true,
      isImage: false,
      isSvg: false,
      mimeType: "application/octet-stream",
      encoding: "base64",
      size,
    };
  }

  return {
    content: buffer.toString("utf8"),
    isBinary: false,
    isImage: false,
    isSvg: false,
    mimeType: "text/plain",
    encoding: "utf8",
    size,
  };
};
