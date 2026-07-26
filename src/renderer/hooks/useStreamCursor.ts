import { useEffect, useState } from "react";
import { readThemeCache } from "../components/sidebar/themeSettings/themeSettingsUtils";
import type { ThemeStreamCursor } from "../components/sidebar/themeSettings/types";

/**
 * 轻量级 Hook：从 localStorage 主题缓存中读取流式光标配置。
 *
 * 不触发任何 IPC 调用——主题持久化在 Rust 后端，但每次保存后
 * ThemeSettingsPanel 会即时写入 localStorage 缓存（writeThemeCache），
 * 因此这里读取的值始终是最新的。
 *
 * 监听 theme:changed 事件以在设置面板保存后即时刷新。
 */
export const useStreamCursor = (): ThemeStreamCursor => {
  const [cursor, setCursor] = useState<ThemeStreamCursor>(() => {
    const cached = readThemeCache();
    return (
      cached?.streamCursor ?? {
        iconType: "dot",
        lucideName: "",
        svgPath: "",
        iconSize: 14,
      }
    );
  });

  useEffect(() => {
    const refresh = (): void => {
      const cached = readThemeCache();
      if (cached) {
        setCursor(cached.streamCursor);
      }
    };
    window.addEventListener("theme:changed", refresh);
    return () => {
      window.removeEventListener("theme:changed", refresh);
    };
  }, []);

  return cursor;
};
