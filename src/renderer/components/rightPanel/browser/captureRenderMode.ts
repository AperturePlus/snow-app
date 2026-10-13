/**
 * 非激活浏览器 tab 的 pane 是 display:none，webview 不产帧，CDP 截图
 * （Page.captureScreenshot）会一直挂起。截图期间把目标 pane 临时切到
 * 「仍在视口内绘制 + 置顶 + 全透明 + 不吃指针事件」的渲染态（见
 * styles.css 的 .right-panel-tab-pane.capture-render），用户看不到切换，
 * 结束后立即恢复 display:none。
 */

const CAPTURE_RENDER_CLASS = "capture-render";
const LAYOUT_POLL_TIMEOUT_MS = 900;
const LAYOUT_POLL_INTERVAL_MS = 60;
const FRAME_SETTLE_MS = 400;

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });

const findBrowserPane = (instanceId: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(
    `.right-panel-tab-pane[data-browser-instance-id="${CSS.escape(instanceId)}"]`,
  );

const waitForPaneLayout = async (pane: HTMLElement): Promise<void> => {
  const deadline = Date.now() + LAYOUT_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const rect = pane.getBoundingClientRect();
    if (rect.width > 1 && rect.height > 1) {
      return;
    }
    await delay(LAYOUT_POLL_INTERVAL_MS);
  }
};

export const withCaptureRenderMode = async <T>(
  instanceId: string,
  run: () => Promise<T>,
): Promise<T> => {
  const pane = findBrowserPane(instanceId);
  // pane 不在本窗口（独立浏览器窗口）或本就是激活 tab：无需渲染态切换。
  if (!pane || pane.classList.contains("active")) {
    return run();
  }
  pane.classList.add(CAPTURE_RENDER_CLASS);
  try {
    await waitForPaneLayout(pane);
    await nextFrame();
    await nextFrame();
    await delay(FRAME_SETTLE_MS);
    return await run();
  } finally {
    pane.classList.remove(CAPTURE_RENDER_CLASS);
  }
};
