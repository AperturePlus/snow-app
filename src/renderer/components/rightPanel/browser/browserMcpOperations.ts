import { captureWebviewPage } from "./captureWebviewPage";
import type { BrowserMcpCommandArgs } from "./browserMcpController";

const TEXT_PREVIEW_LENGTH = 160;
const MAX_SCREENSHOT_BYTES = 20 * 1024 * 1024;

const requiredString = (args: BrowserMcpCommandArgs, field: string): string => {
  const value = args[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required`);
  }
  return value.trim();
};

const optionalString = (
  args: BrowserMcpCommandArgs,
  field: string
): string | undefined => {
  const value = args[field];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} must be a non-empty string when provided`);
  }
  return value.trim();
};

const currentPageMetadata = async (
  webview: Electron.WebviewTag,
  instanceId: string
): Promise<{ instanceId: string; url: string; title: string }> => ({
  instanceId,
  url: webview.getURL(),
  title: await webview.executeJavaScript("document.title || ''"),
});

const waitForNavigation = (
  webview: Electron.WebviewTag,
  url: string,
  timeoutMs: number
): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    let sawSuccessfulNavigation = false;
    const handleNavigate = (): void => {
      sawSuccessfulNavigation = true;
    };
    const handleStop = (): void => {
      cleanup();
      resolve();
    };
    const handleFail = (
      event: Event & {
        errorCode?: number;
        errorDescription?: string;
        validatedURL?: string;
        isMainFrame?: boolean;
      }
    ): void => {
      if (event.isMainFrame === false) {
        return;
      }
      if (
        event.errorCode === -3 ||
        (event.errorCode === -2 && sawSuccessfulNavigation)
      ) {
        return;
      }
      cleanup();
      reject(
        new Error(
          event.errorDescription ||
            `Failed to navigate browser to ${event.validatedURL || url}`
        )
      );
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Browser navigation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    const cleanup = (): void => {
      clearTimeout(timer);
      webview.removeEventListener(
        "did-navigate",
        handleNavigate as EventListener
      );
      webview.removeEventListener(
        "did-navigate-in-page",
        handleNavigate as EventListener
      );
      webview.removeEventListener(
        "did-stop-loading",
        handleStop as EventListener
      );
      webview.removeEventListener("did-fail-load", handleFail as EventListener);
    };

    webview.addEventListener("did-navigate", handleNavigate as EventListener);
    webview.addEventListener(
      "did-navigate-in-page",
      handleNavigate as EventListener
    );
    webview.addEventListener("did-stop-loading", handleStop as EventListener);
    webview.addEventListener("did-fail-load", handleFail as EventListener);
    Promise.resolve(webview.loadURL(url)).catch((error: unknown) => {
      const code =
        error instanceof Error
          ? (error as Error & { code?: string }).code
          : undefined;
      if (code === "ERR_ABORTED" || code === "ERR_FAILED") {
        return;
      }
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });

const navigate = async (
  webview: Electron.WebviewTag,
  instanceId: string,
  args: BrowserMcpCommandArgs
): Promise<unknown> => {
  const url = requiredString(args, "url");
  const timeoutMs =
    typeof args.timeoutMs === "number" ? args.timeoutMs : 30_000;
  await waitForNavigation(webview, url, timeoutMs);
  return {
    ...(await currentPageMetadata(webview, instanceId)),
    success: true,
  };
};

const click = async (
  webview: Electron.WebviewTag,
  instanceId: string,
  args: BrowserMcpCommandArgs
): Promise<unknown> => {
  const selector = optionalString(args, "selector");
  const text = optionalString(args, "text");
  const exact = args.exact === true;
  const script = `(() => {
    const selector = ${JSON.stringify(selector ?? null)};
    const text = ${JSON.stringify(text ?? null)};
    const exact = ${JSON.stringify(exact)};
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
    let element = null;
    if (selector) {
      try {
        element = document.querySelector(selector);
      } catch (error) {
        throw new Error('Invalid CSS selector: ' + selector);
      }
    }
    if (!element && text) {
      const candidates = Array.from(document.querySelectorAll(
        'a,button,input,select,textarea,[role="button"],[role="link"],[onclick]'
      ));
      const expected = normalize(text);
      element = candidates.find((candidate) => {
        const actual = normalize(
          candidate.innerText || candidate.textContent || candidate.value || candidate.getAttribute('aria-label')
        );
        return exact ? actual === expected : actual.includes(expected);
      }) || null;
    }
    if (!element) {
      throw new Error('Clickable element was not found');
    }
    element.scrollIntoView({ block: 'center', inline: 'center' });
    element.click();
    return {
      tagName: element.tagName.toLowerCase(),
      id: element.id || null,
      text: normalize(element.innerText || element.textContent || element.value).slice(0, ${TEXT_PREVIEW_LENGTH}),
      href: element.href || null,
    };
  })()`;
  const element = await webview.executeJavaScript(script);
  return {
    ...(await currentPageMetadata(webview, instanceId)),
    success: true,
    element,
  };
};

const screenshot = async (
  webview: Electron.WebviewTag,
  instanceId: string,
  args: BrowserMcpCommandArgs
): Promise<unknown> => {
  const fullPage = args.fullPage !== false;
  const dataUrl = fullPage
    ? await captureWebviewPage(webview)
    : (await webview.capturePage()).toDataURL();
  if (!dataUrl.startsWith("data:image/png;base64,")) {
    throw new Error("Browser screenshot did not return PNG data");
  }
  const base64 = dataUrl.slice("data:image/png;base64,".length);
  const estimatedBytes = Math.floor((base64.length * 3) / 4);
  if (estimatedBytes > MAX_SCREENSHOT_BYTES) {
    throw new Error(
      `Browser screenshot is too large to return (${estimatedBytes} bytes, maximum ${MAX_SCREENSHOT_BYTES} bytes)`
    );
  }
  const metadata = await currentPageMetadata(webview, instanceId);
  return {
    ...metadata,
    fullPage,
    content: [
      {
        type: "text",
        text: `Browser screenshot captured: ${metadata.title || metadata.url}`,
      },
      {
        type: "image",
        data: base64,
        mimeType: "image/png",
      },
    ],
  };
};

const devtools = async (
  webview: Electron.WebviewTag,
  instanceId: string,
  args: BrowserMcpCommandArgs,
  consoleMessages: readonly unknown[]
): Promise<unknown> => {
  const action = typeof args.action === "string" ? args.action : "snapshot";
  if (action === "open") {
    webview.openDevTools();
    return {
      ...(await currentPageMetadata(webview, instanceId)),
      opened: true,
    };
  }
  if (action === "console") {
    return {
      ...(await currentPageMetadata(webview, instanceId)),
      messages: consoleMessages,
      totalMessages: consoleMessages.length,
    };
  }

  const maxContentLength =
    typeof args.maxContentLength === "number" ? args.maxContentLength : 20_000;
  const snapshot = await webview.executeJavaScript(`(() => {
    const text = String(document.body?.innerText || '').slice(0, ${maxContentLength});
    return {
      url: location.href,
      title: document.title || '',
      readyState: document.readyState,
      contentType: document.contentType,
      characterSet: document.characterSet,
      viewport: { width: innerWidth, height: innerHeight },
      document: {
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
      },
      text,
      links: Array.from(document.links).slice(0, 100).map((link) => ({
        text: String(link.innerText || link.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 160),
        href: link.href,
      })),
    };
  })()`);
  return {
    instanceId,
    snapshot,
  };
};

export const executeBrowserMcpOperation = async (
  webview: Electron.WebviewTag,
  instanceId: string,
  operation: string,
  args: BrowserMcpCommandArgs,
  consoleMessages: readonly unknown[]
): Promise<unknown> => {
  switch (operation) {
    case "navigate":
      return navigate(webview, instanceId, args);
    case "click":
      return click(webview, instanceId, args);
    case "screenshot":
      return screenshot(webview, instanceId, args);
    case "devtools":
      return devtools(webview, instanceId, args, consoleMessages);
    default:
      throw new Error(`Unsupported browser operation: ${operation}`);
  }
};
