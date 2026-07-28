import { useEffect, useRef } from "react";

import { useKeyboardShortcutsSettings } from "../components/KeyboardShortcutsProvider";
import {
  SHORTCUT_ACTIONS,
  matchKey,
  shouldPreventDefault,
} from "../utils/shortcutUtils";

/**
 * 核心快捷键引擎 hook。
 *
 * 在 document 上注册单个 keydown 监听器，根据 KeyboardShortcutsProvider
 * 中的设置和已注册的 handler 分发快捷键动作。
 *
 * 工作流程：
 * 1. 读取 settingsRef（同步，避免闭包过期）
 * 2. 遍历 6 个快捷键动作，检查是否匹配当前按键
 * 3. 若匹配且 enabled=true，调用对应 handler
 * 4. 若需要，preventDefault 阻止浏览器默认行为
 *
 * foregroundOnly 语义说明：
 * - 渲染进程 keydown 监听天然仅在应用聚焦时触发（失焦时浏览器不接收键盘事件）
 * - 因此无论 foregroundOnly 开/关，行为一致（仅应用聚焦时生效）
 * - 这是渲染进程方案的固有限制，未来可用 globalShortcut 增强
 */
export const useKeyboardShortcuts = (): void => {
  const { settings, getHandler } = useKeyboardShortcutsSettings();

  // 使用 ref 持有最新的 settings 和 getHandler，使 keydown listener
  // 总是读取最新值而无需重新注册。
  const settingsRef = useRef(settings);
  const getHandlerRef = useRef(getHandler);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    getHandlerRef.current = getHandler;
  }, [getHandler]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const currentSettings = settingsRef.current;
      const currentGetHandler = getHandlerRef.current;

      for (const action of SHORTCUT_ACTIONS) {
        const config = currentSettings[action];
        if (!config.enabled) continue;

        if (!matchKey(event, config.key)) continue;

        const handler = currentGetHandler(action);
        if (!handler) continue;

        // 匹配成功：阻止默认行为并调用 handler
        if (shouldPreventDefault(config.key)) {
          event.preventDefault();
        }
        handler();
        return; // 仅触发第一个匹配的动作
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, []);
};
