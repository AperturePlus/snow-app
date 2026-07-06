/**
 * Utilities for capturing a full-page screenshot from an Electron webview.
 *
 * `webview.capturePage()` only captures the visible viewport. To avoid
 * scrollbar clipping and capture the entire scrollable page, we:
 *   1. Inject CSS to hide all scrollbars (so they don't steal width/height).
 *   2. Read the page's full scroll dimensions.
 *   3. Temporarily resize the webview element to those dimensions so the
 *      full content is rendered and capturable.
 *   4. Wait for two animation frames so the page re-layouts.
 *   5. Call `capturePage()` and return the PNG data URL.
 *   6. Restore the webview's original style and remove the injected CSS.
 */

const HIDE_SCROLLBAR_STYLE_ID = "__screenshot-hide-scrollbar";

/**
 * Injects a <style> element into the webview's page that hides every
 * scrollbar (WebKit + Firefox + IE/Edge) so they don't clip the content.
 */
const injectScrollbarHider = async (
  webview: Electron.WebviewTag
): Promise<void> => {
  await webview.executeJavaScript(
    "(() => {" +
      "  const existing = document.getElementById('" +
      HIDE_SCROLLBAR_STYLE_ID +
      "');" +
      "  if (existing) return;" +
      "  const style = document.createElement('style');" +
      "  style.id = '" +
      HIDE_SCROLLBAR_STYLE_ID +
      "';" +
      "  style.textContent =" +
      "    '::-webkit-scrollbar{width:0!important;height:0!important;display:none!important}'" +
      "    + 'html{scrollbar-width:none!important;-ms-overflow-style:none!important}';" +
      "  document.head.appendChild(style);" +
      "})();"
  );
};

/**
 * Removes the scrollbar-hiding <style> element previously injected.
 */
const removeScrollbarHider = async (
  webview: Electron.WebviewTag
): Promise<void> => {
  await webview.executeJavaScript(
    "document.getElementById('" +
      HIDE_SCROLLBAR_STYLE_ID +
      "')?.remove();"
  );
};

type PageDimensions = {
  scrollWidth: number;
  scrollHeight: number;
  clientWidth: number;
  clientHeight: number;
};

/**
 * Reads the full scrollable dimensions of the page plus the current
 * viewport dimensions.
 */
const getPageDimensions = async (
  webview: Electron.WebviewTag
): Promise<PageDimensions> => {
  return webview.executeJavaScript(
    "(() => {" +
      "  const el = document.documentElement;" +
      "  return {" +
      "    scrollWidth: el.scrollWidth," +
      "    scrollHeight: el.scrollHeight," +
      "    clientWidth: el.clientWidth," +
      "    clientHeight: el.clientHeight," +
      "  };" +
      "})();"
  );
};

/**
 * Waits for two animation frames so the webview has time to re-layout
 * after being resized.
 */
const waitForRerender = async (
  webview: Electron.WebviewTag
): Promise<void> => {
  await webview.executeJavaScript(
    "new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))"
  );
};

/**
 * Captures the full page content of a webview as a PNG data URL.
 *
 * Temporarily hides scrollbars and resizes the webview to fit the entire
 * scrollable page so that `capturePage()` captures all content, not just
 * the visible viewport. The webview's original state is always restored
 * before the function returns (even on error).
 */
export const captureWebviewPage = async (
  webview: Electron.WebviewTag
): Promise<string> => {
  // Restoration tasks are collected and run in reverse order in `finally`.
  const restoreTasks: Array<() => Promise<void> | void> = [];

  try {
    // 1. Hide scrollbars so they don't clip or overlap the content.
    await injectScrollbarHider(webview);
    restoreTasks.push(() => removeScrollbarHider(webview));

    // 2. Determine whether the page extends beyond the viewport.
    const { scrollWidth, scrollHeight, clientWidth, clientHeight } =
      await getPageDimensions(webview);

    const needsResize =
      scrollHeight > clientHeight || scrollWidth > clientWidth;

    // 3. Temporarily resize the webview to the full page dimensions so
    //    that all content is rendered and capturable.
    if (needsResize) {
      const originalCssText = webview.style.cssText;
      webview.style.width = scrollWidth + "px";
      webview.style.height = scrollHeight + "px";
      restoreTasks.unshift(() => {
        webview.style.cssText = originalCssText;
      });

      await waitForRerender(webview);
    }

    // 4. Capture the full page.
    const image = await webview.capturePage();
    const dataUrl = image.toDataURL();
    if (!dataUrl) {
      throw new Error("Captured image is empty");
    }

    return dataUrl;
  } finally {
    // Restore in reverse order of application.
    for (const task of restoreTasks) {
      try {
        await task();
      } catch {
        // Ignore restoration errors.
      }
    }
  }
};
