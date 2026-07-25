import { protocol, net } from "electron";
import {
  IMG_PROXY_SCHEME,
  decodeImageProxyUrl,
} from "../../renderer/utils/imageProxyUrl";

let registered = false;

/** 代理图片下载的最大字节数，避免被超大响应拖垮主进程内存。 */
const MAX_IMAGE_BYTES = 50 * 1024 * 1024; // 50 MB

/**
 * 注册 img-proxy:// 自定义协议，代理外部 HTTP/HTTPS 图片。
 *
 * URL 格式：img-proxy://localhost/<encodeURIComponent(原始图片 URL)>
 *
 * 渲染进程通过 imageProxyUrl(url) 构造 URL，主进程用 net.fetch（基于 Chromium
 * 网络栈，异步非阻塞）请求原始图片并透传响应。这样 CSP 只需放行 img-proxy:
 * 而无需放开 https:，外部请求由主进程统一处理。
 *
 * 必须在 app.whenReady() 之后调用。
 */
export const registerImageProxyProtocol = (): void => {
  if (registered) {
    return;
  }
  registered = true;

  protocol.handle(IMG_PROXY_SCHEME, async (request) => {
    try {
      const originalUrl = decodeImageProxyUrl(request.url);

      // 仅允许 http/https，防止通过代理绕过 CSP 访问 file:/data: 等资源。
      if (!/^https?:\/\//i.test(originalUrl)) {
        return new Response("Forbidden: only http(s) URLs can be proxied", {
          status: 403,
        });
      }

      const upstream = await net.fetch(originalUrl, {
        redirect: "follow",
        // 避免主进程挂载本地 Cookie 仓库泄露给第三方图床。
        credentials: "omit",
      });

      if (!upstream.ok) {
        return new Response(`Upstream responded ${upstream.status}`, {
          status: upstream.status,
        });
      }

      // 校验 Content-Type，避免被当作图片代理拉取 HTML/JSON 等。
      const contentType = upstream.headers.get("content-type") ?? "";
      if (!contentType.toLowerCase().startsWith("image/")) {
        return new Response(`Unsupported content-type: ${contentType}`, {
          status: 415,
        });
      }

      // 限制响应体大小，防止超大文件耗尽内存。
      const contentLength = Number(upstream.headers.get("content-length") ?? 0);
      if (contentLength > MAX_IMAGE_BYTES) {
        return new Response("Image too large", { status: 413 });
      }

      // 读取后转发，避免上游流式响应被 Chromium 挂起；同时便于二次大小校验。
      const buffer = await upstream.arrayBuffer();
      if (buffer.byteLength > MAX_IMAGE_BYTES) {
        return new Response("Image too large", { status: 413 });
      }

      const headers = new Headers();
      headers.set("Content-Type", contentType);
      // 不允许客户端缓存代理结果，避免改图后不刷新；如需缓存可在主进程做 LRU。
      headers.set("Cache-Control", "no-store");

      return new Response(buffer, {
        status: 200,
        headers,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return new Response(`Failed to proxy image: ${message}`, {
        status: 502,
      });
    }
  });
};

/**
 * 在 app.whenReady 之前调用，声明 scheme 特权。
 * 这样 Chromium 才会允许在 <img src> 中加载该协议的资源。
 */
export const registerImageProxySchemePrivilege = (): void => {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: IMG_PROXY_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: false,
      },
    },
  ]);
};
