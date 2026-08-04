import { ipcMain } from "electron";
import { readFile } from "fs/promises";
import { dirname, join, normalize, sep } from "path";
import type { NativeBridge } from "../../native/types";

/**
 * 图片相关 IPC。
 *
 * `images:resolve-upload-image`：把 upload 目录下的相对路径解析为 data URL，
 * 供渲染端展示会话内图片（如 imagegen 参考图缩略图）。渲染进程无法直接
 * 访问磁盘，必须经主进程读取。
 */
export const registerImageHandlers = (native: NativeBridge): void => {
  ipcMain.handle(
    "images:resolve-upload-image",
    async (_event, relativePath: unknown): Promise<string | null> => {
      if (typeof relativePath !== "string") {
        return null;
      }
      const normalized = relativePath.trim().replace(/\\/g, "/");
      // 仅允许 upload 目录内的相对路径，拒绝绝对路径与路径穿越（..）
      if (!normalized.startsWith("upload/") || normalized.includes("..")) {
        return null;
      }
      try {
        const storageInfo = await native.initializeAppStorage();
        const uploadRoot = join(dirname(storageInfo.databasePath), "upload");
        const filePath = normalize(join(uploadRoot, normalized));
        // 二次校验：解析后的路径必须仍在 upload 目录内
        const rootPrefix = uploadRoot.endsWith(sep)
          ? uploadRoot
          : uploadRoot + sep;
        if (
          filePath !== uploadRoot &&
          !filePath.toLowerCase().startsWith(rootPrefix.toLowerCase())
        ) {
          return null;
        }
        const bytes = await readFile(filePath);
        const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
        const mimeType =
          ext === "png"
            ? "image/png"
            : ext === "jpg" || ext === "jpeg"
              ? "image/jpeg"
              : ext === "webp"
                ? "image/webp"
                : ext === "gif"
                  ? "image/gif"
                  : ext === "bmp"
                    ? "image/bmp"
                    : "image/png";
        return `data:${mimeType};base64,${bytes.toString("base64")}`;
      } catch {
        // 文件不存在/读取失败等一律返回 null，渲染端回退到占位展示
        return null;
      }
    }
  );
};
