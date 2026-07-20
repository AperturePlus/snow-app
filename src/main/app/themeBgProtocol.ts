import { protocol, net } from "electron";
import { join } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { THEME_BG_SCHEME, themeBgUrl } from "../../renderer/utils/themeBgUrl";

/**
 * 背景图允许的根目录。协议处理器只允许读取该目录下的文件，
 * 防止渲染进程通过构造 URL 读取任意本地文件。
 */
const ALLOWED_DIR = join(homedir(), ".snowapp", "backgrounds");

let registered = false;

/**
 * 注册 theme-bg:// 自定义协议。
 *
 * URL 格式：theme-bg://localhost/<encodeURIComponent(绝对路径)>
 *
 * 渲染进程通过 themeBgUrl(path) 构造 URL，主进程通过 protocol.handle
 * 读取本地文件并返回 Response。这样既绕过了 Chromium 对 file:// 的同源限制，
 * 又通过路径白名单保证了安全性。
 *
 * 必须在 app.whenReady() 之后调用。
 */
export const registerThemeBgProtocol = (): void => {
  if (registered) {
    return;
  }
  registered = true;

  protocol.handle(THEME_BG_SCHEME, async (request) => {
    try {
      // request.url 形如 theme-bg://localhost/<encoded-path>
      // pathname 部分就是编码后的绝对路径（前导 / 需要去掉）。
      const url = new URL(request.url);
      const encodedPath = url.pathname.replace(/^\//, "");
      const filePath = decodeURIComponent(encodedPath);

      // 安全检查：只允许读取 ALLOWED_DIR 下的文件。
      const normalized = join(filePath);
      if (!normalized.startsWith(ALLOWED_DIR)) {
        return new Response("Forbidden: path outside backgrounds directory", {
          status: 403,
        });
      }

      const fileUrl = pathToFileURL(normalized).toString();
      const response = await net.fetch(fileUrl);
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return new Response(`Failed to load theme background: ${message}`, {
        status: 500,
      });
    }
  });
};

/**
 * 在 app.whenReady 之前调用，声明 scheme 特权。
 * 这样 Chromium 才会允许在 CSS url() 和 <img src> 中加载该协议的资源。
 */
export const registerThemeBgSchemePrivilege = (): void => {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: THEME_BG_SCHEME,
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

// 重新导出，方便主进程其他模块使用。
export { themeBgUrl };
