import { ipcRenderer } from "electron";
import type { ImageLibraryRecord } from "../types/imageLibrary";

/** 图像管理系统（Image Library）API。 */
export const imageLibraryApi = {
  /** 图库根目录绝对路径（安装目录旁 image/，供展示存储位置用） */
  getImageLibraryRoot: (): Promise<string> =>
    ipcRenderer.invoke("images:library-root"),

  /** 列出全部生成图片（按创建时间倒序） */
  listImageLibrary: (): Promise<ImageLibraryRecord[]> =>
    ipcRenderer.invoke("images:library-list"),

  /** 删除图片：物理文件 + 索引 + 同步重写引用该图的会话消息 */
  deleteImageLibraryImage: (id: string): Promise<void> =>
    ipcRenderer.invoke("images:library-delete", id),

  /** 把图库相对路径（image/...）解析为 data URL，失败返回 null */
  resolveLibraryImage: (relativePath: string): Promise<string | null> =>
    ipcRenderer.invoke("images:resolve-library-image", relativePath),

  /** 统计指定会话中引用的图库图片数量（删除会话确认框用） */
  countConversationImages: (conversationIds: string[]): Promise<number> =>
    ipcRenderer.invoke("images:conversation-images-count", conversationIds),

  /** 级联删除指定会话中引用的图库图片（删除会话时选择不保留图片） */
  deleteConversationImages: (conversationIds: string[]): Promise<number> =>
    ipcRenderer.invoke("images:delete-conversation-images", conversationIds),
};
