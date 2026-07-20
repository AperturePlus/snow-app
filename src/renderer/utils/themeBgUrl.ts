/**
 * 主题背景图自定义协议工具。
 *
 * 主进程通过 protocol.handle 注册 theme-bg:// 协议读取本地文件，
 * 渲染进程通过 themeBgUrl(path) 构造 URL 用于 CSS url() 和 <img src>。
 *
 * 这个文件是纯函数，不依赖 electron 模块，主进程和渲染进程均可导入。
 */

export const THEME_BG_SCHEME = "theme-bg";

/**
 * 将本地文件绝对路径转换为 theme-bg:// URL。
 * 主进程的 protocol.handle 会解码路径并读取文件内容返回。
 *
 * 路径用 encodeURIComponent 编码，避免特殊字符（空格、中文等）破坏 URL。
 */
export const themeBgUrl = (filePath: string): string => {
  const normalized = filePath.replace(/\\/g, "/");
  return `${THEME_BG_SCHEME}://localhost/${encodeURIComponent(normalized)}`;
};
