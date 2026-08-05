import { ipcMain } from "electron";
import type { NativeBridge } from "../../native/types";

/**
 * 图像管理系统（Image Library）IPC。
 *
 * - `images:library-root`：图库根目录绝对路径（安装目录旁 image/）
 * - `images:library-list`：列出全部生成图片（按时间倒序）
 * - `images:library-delete`：删除图片（物理文件 + 索引 + 同步重写会话消息）
 * - `images:resolve-library-image`：把 image/ 相对路径解析为 data URL
 */
export const registerImageLibraryHandlers = (native: NativeBridge): void => {
  ipcMain.handle("images:library-root", async (): Promise<string> => {
    return native.getImageLibraryRoot();
  });

  ipcMain.handle("images:library-list", async (): Promise<unknown> => {
    return native.listImageLibrary();
  });

  ipcMain.handle(
    "images:library-delete",
    async (_event, id: unknown): Promise<void> => {
      if (typeof id !== "string" || id.trim() === "") {
        throw new Error("Invalid image library id");
      }
      await native.deleteImageLibraryImage(id.trim());
    }
  );

  ipcMain.handle(
    "images:resolve-library-image",
    async (_event, relativePath: unknown): Promise<string | null> => {
      if (typeof relativePath !== "string") {
        return null;
      }
      return native.readImageLibraryFile(relativePath.trim());
    }
  );

  ipcMain.handle(
    "images:conversation-images-count",
    async (_event, conversationIds: unknown): Promise<number> => {
      if (!Array.isArray(conversationIds)) {
        return 0;
      }
      const safeIds = conversationIds.filter(
        (id): id is string => typeof id === "string" && id.trim() !== ""
      );
      if (safeIds.length === 0) {
        return 0;
      }
      return native.countConversationImages(safeIds);
    }
  );

  ipcMain.handle(
    "images:delete-conversation-images",
    async (_event, conversationIds: unknown): Promise<number> => {
      if (!Array.isArray(conversationIds)) {
        return 0;
      }
      const safeIds = conversationIds.filter(
        (id): id is string => typeof id === "string" && id.trim() !== ""
      );
      if (safeIds.length === 0) {
        return 0;
      }
      return native.deleteConversationImages(safeIds);
    }
  );
};
