import { app, screen } from "electron";
import type { BrowserWindow, Rectangle } from "electron";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface WindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  isMaximized?: boolean;
}

export const DEFAULT_WINDOW_WIDTH = 1400;
export const DEFAULT_WINDOW_HEIGHT = 900;

// 窗口状态持久化到 userData 下的 JSON 文件。
// 不能用渲染进程的 localStorage：主进程在创建窗口前就需要拿到尺寸，
// 此时渲染进程尚未加载，无法读取浏览器缓存。
const getWindowStatePath = (): string =>
  join(app.getPath("userData"), "window-state.json");

export const loadWindowState = async (): Promise<WindowState | null> => {
  try {
    const raw = await readFile(getWindowStatePath(), "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    const state = parsed as Partial<WindowState>;
    if (
      typeof state.width !== "number" ||
      typeof state.height !== "number" ||
      state.width <= 0 ||
      state.height <= 0
    ) {
      return null;
    }
    return {
      width: Math.round(state.width),
      height: Math.round(state.height),
      x: typeof state.x === "number" ? Math.round(state.x) : undefined,
      y: typeof state.y === "number" ? Math.round(state.y) : undefined,
      isMaximized: state.isMaximized === true,
    };
  } catch {
    // 文件不存在或内容损坏时回退到默认尺寸。
    return null;
  }
};

// 校验保存的位置是否仍落在某块显示器的可见区域内，
// 避免拔掉外接显示器后窗口恢复到屏幕外。
export const isStatePositionVisible = (state: WindowState): boolean => {
  if (typeof state.x !== "number" || typeof state.y !== "number") {
    return false;
  }
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    return (
      state.x! >= area.x &&
      state.y! >= area.y &&
      state.x! < area.x + area.width &&
      state.y! < area.y + area.height
    );
  });
};

// 清除后暂停持久化：否则窗口关闭时的落盘会立刻重建缓存，使清除失效。
// 用户再次主动调整窗口（resize/move/maximize）时自动恢复持久化。
let persistencePaused = false;

const writeWindowState = (window: BrowserWindow): void => {
  if (persistencePaused || window.isDestroyed()) {
    return;
  }
  const isMaximized = window.isMaximized();
  // 最大化状态下保存还原前的 normal bounds，
  // 否则重启后会把最大化的尺寸当作普通尺寸恢复。
  const bounds: Rectangle = isMaximized
    ? window.getNormalBounds()
    : window.getBounds();
  const state: WindowState = { ...bounds, isMaximized };
  writeFile(getWindowStatePath(), JSON.stringify(state), "utf-8").catch(
    (error) => {
      console.warn("Failed to persist window state:", error);
    }
  );
};

// 清除已保存的窗口状态（如主题重置时一并还原窗口尺寸），
// 下次启动将回退到默认尺寸。文件不存在时视为成功。
export const clearWindowState = async (): Promise<void> => {
  persistencePaused = true;
  try {
    await unlink(getWindowStatePath());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn("Failed to clear window state:", error);
    }
  }
};

// resize/move 事件频率很高，防抖后再落盘，避免高频写文件。
let saveStateTimer: NodeJS.Timeout | null = null;

export const bindWindowStatePersistence = (window: BrowserWindow): void => {
  const scheduleSave = (): void => {
    // 用户再次主动调整窗口，恢复持久化。
    persistencePaused = false;
    if (saveStateTimer) {
      clearTimeout(saveStateTimer);
    }
    saveStateTimer = setTimeout(() => {
      saveStateTimer = null;
      writeWindowState(window);
    }, 500);
  };

  window.on("resize", scheduleSave);
  window.on("move", scheduleSave);
  window.on("maximize", scheduleSave);
  window.on("unmaximize", scheduleSave);

  // 关闭时立即落盘一次，确保最后的尺寸不会丢失。
  window.on("close", () => {
    if (saveStateTimer) {
      clearTimeout(saveStateTimer);
      saveStateTimer = null;
    }
    writeWindowState(window);
  });
};
