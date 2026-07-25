/**
 * Markdown 图片代理自定义协议工具。
 *
 * 主进程通过 protocol.handle 注册 img-proxy:// 协议代理外部 HTTP/HTTPS 图片，
 * 渲染进程通过 imageProxyUrl(originalUrl) 构造代理 URL。
 *
 * 这个文件是纯函数，不依赖 electron 模块，主进程和渲染进程（含 Web Worker）均可导入。
 *
 * 存在动机：CSP 的 img-src 不允许 http:/https:，外部图片会被拒绝加载。
 * 通过自定义协议代理，CSP 只需放行 img-proxy: 即可，外部请求由主进程的
 * net.fetch（基于 Chromium 网络栈，异步非阻塞）完成，不卡 Node.js 事件循环。
 */

export const IMG_PROXY_SCHEME = "img-proxy";

/** 仅允许代理 http/https URL，禁止 file:、data: 等被构造成代理地址。 */
const HTTP_OR_HTTPS = /^https?:\/\//i;

/**
 * 将外部 http(s) 图片 URL 转换为 img-proxy:// 代理 URL。
 * 非法 scheme 原样返回，避免误代理本地资源或已有 data: URL。
 */
export const imageProxyUrl = (originalUrl: string): string => {
  if (!HTTP_OR_HTTPS.test(originalUrl)) {
    return originalUrl;
  }
  return `${IMG_PROXY_SCHEME}://localhost/${encodeURIComponent(originalUrl)}`;
};

/**
 * 解码 img-proxy:// URL，还原出原始外部图片 URL。
 * 主进程协议处理器使用。
 */
export const decodeImageProxyUrl = (proxyUrl: string): string => {
  const url = new URL(proxyUrl);
  const encoded = url.pathname.replace(/^\//, "");
  return decodeURIComponent(encoded);
};
