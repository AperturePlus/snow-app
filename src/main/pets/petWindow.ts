/**
 * 桌面宠物窗口管理器。
 *
 * 宠物以独立的透明无边框置顶窗口呈现（与 Codex App 的呈现方式一致），
 * 加载渲染进程的 pet.html 页面绘制精灵图动画。主进程负责：
 * - 窗口生命周期（唤醒 / 收起 / 退出清理）
 * - 形态切换（精灵 ↔ 聊天：双击宠物变形为小对话窗口，关闭后变回精灵）
 * - 窗口移动（渲染层自绘拖拽，主进程按屏幕位移 setBounds，见下方 drag 段）
 * - 活动状态机（忙碌 / 等待 / 出错 / 完成 / 待机）并广播给宠物窗口
 * - 右键菜单（菜单项由主进程构建，见 showPetContextMenu）
 *
 * 位置策略：每次唤醒都出现在固定的默认位置（应用主窗口右下角），
 * 主窗口不可用时回退到主显示器工作区右下角，不做跨会话位置持久化，
 * 避免宠物出现在屏幕外而"找不到"。
 */
import {
  app,
  BrowserWindow,
  Menu,
  screen,
  type MenuItemConstructorOptions,
  type Rectangle,
  type WebContents,
} from "electron";
import { is } from "@electron-toolkit/utils";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { NativeBridge, PetManifestRecord } from "../native/types";
import { snowLog } from "../../utils/snowLogger";
import { safeSend } from "../utils/safeSend";
import { getMainWindow } from "../app/mainWindow";
import { isMacOS } from "../app/constants";
import { tMain } from "../i18n/mainI18n";
import { getPetChatContext, type PetChatContext } from "./petChat";
import {
  loadPetSettings,
  savePetSettings,
  type PetActivityState,
  type PetSettings,
  type PetTurnKind,
} from "./petSettings";

/** Codex 精灵图单帧宽度（像素）。 */
const PET_FRAME_WIDTH = 192;
/** Codex 精灵图单帧高度（像素）。 */
const PET_FRAME_HEIGHT = 208;
/** 窗口四周预留空间（跳跃/挥手等动作的位移余量）。 */
const PET_WINDOW_PADDING = 12;
/** 一次流结束到回落 idle 的延迟（避免连续工具调用间状态抖动）。 */
const SETTLE_DELAY_MS = 3000;
/** 拖拽停止后回落到基础状态的延迟（毫秒）。 */
const DRAG_DIRECTION_SETTLE_MS = 160;
/** 唤醒时与屏幕边缘的间距。 */
const WAKE_EDGE_MARGIN = 24;
/**
 * 右键菜单弹出抑制窗口（毫秒）：同一次右键可能同时命中渲染层 IPC 与
 * Windows 非客户区 system-context-menu 两条路径，只放行第一条。
 */
const MENU_POPUP_GUARD_MS = 250;
/** 聊天形态窗口尺寸（与宠物缩放无关，保证输入区可用）。 */
const CHAT_WINDOW_WIDTH = 340;
const CHAT_WINDOW_HEIGHT = 460;

/** 宠物窗口形态：精灵（桌面宠物）/ 聊天（双击变形后的小对话窗口）。 */
export type PetWindowMode = "sprite" | "chat";

/** 宠物聊天窗口的界面文案（主进程按当前语言下发，宠物页面无 i18n 上下文）。 */
export type PetChatLabels = {
  placeholder: string;
  send: string;
  stop: string;
  newChat: string;
  close: string;
  thinking: string;
  error: string;
  hintContext: string;
  hintFree: string;
  hintTitle: string;
  /** 工具执行中的状态行文案（联网搜索 / 文件搜索 / 文件阅读） */
  toolRunning: string;
};

/** 发送给宠物窗口 / 设置界面的完整配置。 */
export type PetWindowConfig = {
  settings: PetSettings;
  manifest: PetManifestRecord | null;
  mode: PetWindowMode;
  chatContext: PetChatContext;
  labels: PetChatLabels;
};

const buildChatLabels = (): PetChatLabels => ({
  placeholder: tMain("pet.chat.placeholder"),
  send: tMain("pet.chat.send"),
  stop: tMain("pet.chat.stop"),
  newChat: tMain("pet.chat.newChat"),
  close: tMain("pet.chat.close"),
  thinking: tMain("pet.chat.thinking"),
  error: tMain("pet.chat.error"),
  hintContext: tMain("pet.chat.hintContext"),
  hintFree: tMain("pet.chat.hintFree"),
  hintTitle: tMain("pet.chat.hintTitle"),
  toolRunning: tMain("pet.chat.toolRunning"),
});

let petWindow: BrowserWindow | null = null;
let currentConfig: PetWindowConfig | null = null;
let currentState: PetActivityState = "idle";
/** 当前窗口形态（精灵 / 聊天）。 */
let currentMode: PetWindowMode = "sprite";
/** 最近一次右键菜单弹出时间（去重同一次点击的两条触发路径）。 */
let lastMenuPopupAt = 0;
/**
 * 进行中的 AI 回合，按渲染层生成的 turnId 精确跟踪。
 *
 * 早期实现是匿名的全局计数（start +1 / end -1），多会话并行时一旦
 * start/end 不配对（中止、被新消息顶替、渲染层销毁）计数就会永久漂移，
 * 宠物卡在 busy。改为按 turnId 记账后：重复的 end 幂等忽略，缺失的
 * end 由发送方销毁事件兜底回收。
 */
const activeTurns = new Map<string, { senderId: number; kind: PetTurnKind }>();
let waitingCount = 0;
let settleTimer: NodeJS.Timeout | null = null;
/** 已登记 destroyed 监听的渲染进程（turn 计数的兜底回收）。 */
const watchedTurnSenders = new Set<number>();

const computeWindowSize = (
  scale: number,
): { width: number; height: number } => ({
  width: Math.round(PET_FRAME_WIDTH * scale) + PET_WINDOW_PADDING * 2,
  height: Math.round(PET_FRAME_HEIGHT * scale) + PET_WINDOW_PADDING * 2,
});

/**
 * 形态切换 / 尺寸变化时的落位：保持窗口「水平居中 + 底边对齐」的锚点，
 * 并 clamp 到当前显示器工作区，避免变形后跑出屏幕。
 */
const anchorBounds = (
  current: Rectangle,
  width: number,
  height: number,
): Rectangle => {
  const { workArea } = screen.getDisplayMatching(current);
  const x = Math.round(current.x + current.width / 2 - width / 2);
  const y = Math.round(current.y + current.height - height);
  return {
    x: Math.min(Math.max(x, workArea.x), workArea.x + workArea.width - width),
    y: Math.min(Math.max(y, workArea.y), workArea.y + workArea.height - height),
    width,
    height,
  };
};

/** 目标形态的窗口尺寸：聊天形态用固定尺寸，精灵形态跟随缩放设置。 */
const resolveModeSize = (
  mode: PetWindowMode,
  settings: PetSettings,
): { width: number; height: number } =>
  mode === "chat"
    ? { width: CHAT_WINDOW_WIDTH, height: CHAT_WINDOW_HEIGHT }
    : computeWindowSize(settings.scale);

/**
 * 应用窗口 bounds。非 resizable 窗口在部分平台上直接 setBounds 不生效，
 * 因此临时放开再收回（用户视角依旧不可缩放）。
 */
const applyPetWindowBounds = (bounds: Rectangle): void => {
  if (!petWindow || petWindow.isDestroyed()) {
    return;
  }
  if (petWindow.isMinimized()) {
    petWindow.restore();
  }
  const wasResizable = petWindow.isResizable();
  if (!wasResizable) {
    petWindow.setResizable(true);
  }
  petWindow.setBounds(bounds);
  if (!wasResizable) {
    petWindow.setResizable(false);
  }
};

const resizePetWindow = (mode: PetWindowMode, settings: PetSettings): void => {
  if (!petWindow || petWindow.isDestroyed()) {
    return;
  }
  const { width, height } = resolveModeSize(mode, settings);
  applyPetWindowBounds(anchorBounds(petWindow.getBounds(), width, height));
};

/**
 * 切换宠物窗口形态（精灵 ↔ 聊天）。由宠物窗口双击 / 关闭聊天触发，
 * 变更后重新下发配置，页面据此切换渲染内容。
 */
export const setPetWindowMode = (
  mode: PetWindowMode,
  settings: PetSettings,
): void => {
  if (currentMode === mode) {
    return;
  }
  currentMode = mode;
  resizePetWindow(mode, settings);
  if (mode === "chat") {
    // 双击进入聊天后直接可输入：等 setBounds 落位完成再抢一次焦点，
    // 渲染层的输入框聚焦才不会因为窗口尚未激活而失效。
    setTimeout(() => {
      if (petWindow && !petWindow.isDestroyed()) {
        petWindow.focus();
      }
    }, 60);
  }
  if (currentConfig) {
    currentConfig = { ...currentConfig, mode };
  }
  broadcastConfig();
};

/** 宠物聊天上下文变化（主窗口切换 / 关闭会话）时下发到宠物窗口。 */
export const broadcastPetChatContext = (): void => {
  if (currentConfig) {
    currentConfig = { ...currentConfig, chatContext: getPetChatContext() };
  }
  broadcastConfig();
};

// ── 渲染层自绘拖拽 ───────────────────────────────────────────────────
//
// 宠物窗口不再使用 CSS `-webkit-app-region: drag`：Windows 上 drag 区域被
// 系统当作标题栏（HTCAPTION），渲染层收不到鼠标事件，双击就无法识别。
// 改为渲染层 pointer 捕获 + 这里按位移设置窗口位置，位移使用渲染层上报的
// screenX/screenY 差值（与窗口起始 bounds 相加，不做逐步累加，无漂移）。

/** 拖拽起始时的窗口 bounds（null 表示当前没有拖拽）。 */
let dragOriginBounds: Rectangle | null = null;

export const beginPetWindowDrag = (): void => {
  if (!petWindow || petWindow.isDestroyed()) {
    return;
  }
  dragOriginBounds = petWindow.getBounds();
};

export const movePetWindowDrag = (dx: number, dy: number): void => {
  if (!petWindow || petWindow.isDestroyed() || !dragOriginBounds) {
    return;
  }
  petWindow.setBounds({
    ...dragOriginBounds,
    x: Math.round(dragOriginBounds.x + dx),
    y: Math.round(dragOriginBounds.y + dy),
  });
};

export const endPetWindowDrag = (): void => {
  dragOriginBounds = null;
};

/**
 * 唤醒位置：优先贴靠应用主窗口右下角（跟随主窗口所在显示器），
 * 并 clamp 到该显示器工作区内，防止主窗口贴近屏幕边缘时宠物出界；
 * 主窗口不可用时回退到主显示器工作区右下角。
 */
const resolveWakePosition = (
  width: number,
  height: number,
): { x: number; y: number } => {
  const mainWindow = getMainWindow();
  if (!mainWindow) {
    const workArea = screen.getPrimaryDisplay().workArea;
    return {
      x: workArea.x + workArea.width - width - WAKE_EDGE_MARGIN,
      y: workArea.y + workArea.height - height - WAKE_EDGE_MARGIN,
    };
  }

  const bounds = mainWindow.getBounds();
  const {
    x: areaX,
    y: areaY,
    width: areaWidth,
    height: areaHeight,
  } = screen.getDisplayMatching(bounds).workArea;
  return {
    x: Math.min(
      Math.max(bounds.x + bounds.width - width - WAKE_EDGE_MARGIN, areaX),
      areaX + areaWidth - width,
    ),
    y: Math.min(
      Math.max(bounds.y + bounds.height - height - WAKE_EDGE_MARGIN, areaY),
      areaY + areaHeight - height,
    ),
  };
};

const clearSettleTimer = (): void => {
  if (settleTimer) {
    clearTimeout(settleTimer);
    settleTimer = null;
  }
};

/** 根据当前回合登记解析应展示的活动状态。 */
const resolveActivityState = (): PetActivityState => {
  if (waitingCount > 0) {
    return "waiting";
  }
  let hasTurn = false;
  for (const turn of activeTurns.values()) {
    if (turn.kind === "review") {
      return "review";
    }
    hasTurn = true;
  }
  return hasTurn ? "busy" : "idle";
};

const broadcastState = (): void => {
  if (petWindow && !petWindow.isDestroyed()) {
    safeSend(petWindow.webContents, "pets:activity-changed", currentState);
  }
};

const applyState = (state: PetActivityState): void => {
  if (state === currentState) {
    return;
  }
  currentState = state;
  broadcastState();
};

/** 向所有常规窗口广播宠物配置变化（设置界面据此刷新列表）。 */
const broadcastPetsChanged = (): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window === petWindow || window.isDestroyed()) {
      continue;
    }
    safeSend(window.webContents, "pets:changed");
  }
};

const broadcastConfig = (): void => {
  if (petWindow && !petWindow.isDestroyed() && currentConfig) {
    safeSend(petWindow.webContents, "pets:config-changed", currentConfig);
  }
};

/** 向宠物窗口广播拖拽方向（左/右奔跑），null 表示拖拽停止。 */
const broadcastDragState = (
  state: "running-right" | "running-left" | null,
): void => {
  if (petWindow && !petWindow.isDestroyed()) {
    safeSend(petWindow.webContents, "pets:drag-state", state);
  }
};

/** 解析当前激活宠物的清单（从 Rust 后端的宠物列表中查找）。 */
const resolveActiveManifest = async (
  native: NativeBridge,
  settings: PetSettings,
): Promise<PetManifestRecord | null> => {
  if (!settings.activePetId) {
    return null;
  }
  try {
    const pets = await native.listInstalledPets();
    return pets.find((pet) => pet.id === settings.activePetId) ?? null;
  } catch (error) {
    snowLog.warn({
      module: "pets/petWindow",
      func: "resolveActiveManifest",
      message: "Failed to list installed pets",
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};

const destroyPetWindow = (): void => {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.destroy();
  }
  petWindow = null;
  // 窗口销毁后形态归零，下次唤醒回到精灵形态。
  currentMode = "sprite";
};

/**
 * 收起宠物（右键菜单「关闭宠物」）：与设置面板的开关语义完全一致 ——
 * 持久化 enabled=false 后由 refreshPetWindow 收起窗口，重启不会自动唤醒，
 * 可从设置面板或快捷键（默认 mod+shift+p）重新唤醒。
 */
const closePet = async (native: NativeBridge): Promise<void> => {
  try {
    const settings = await loadPetSettings(native);
    await savePetSettings(native, { ...settings, enabled: false });
    await refreshPetWindow(native);
  } catch (error) {
    snowLog.warn({
      module: "pets/petWindow",
      func: "closePet",
      message: "Failed to persist pet disabled state",
      error: error instanceof Error ? error.message : String(error),
    });
    destroyPetWindow();
    broadcastPetsChanged();
  }
};

/**
 * 打开宠物设置页（右键菜单「宠物设置」）：聚焦主窗口并请求侧栏切到
 * 「桌面宠物」设置视图。宠物窗口自身没有 Sidebar，复用主窗口既有的
 * app-control:open-settings-broadcast 转发通道（与独立浏览器窗口同一路径）。
 */
const openPetSettings = (): void => {
  const mainWindow = getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }
  mainWindow.focus();
  safeSend(
    mainWindow.webContents,
    "app-control:open-settings-broadcast",
    "pets-settings",
  );
};

/**
 * 弹出宠物右键菜单（菜单项在主进程构建，后续可继续扩充）。
 *
 * 触发有两条互补路径，同一次右键可能都命中，用时间窗去重：
 * 1. 渲染层 contextmenu → IPC pets:show-context-menu（常规路径）；
 * 2. Windows 上拖拽区域被系统当作标题栏，右键走非客户区 WM_CONTEXTMENU，
 *    渲染层收不到事件，只能由窗口的 system-context-menu 兜底。
 */
export const showPetContextMenu = (native: NativeBridge): void => {
  if (!petWindow || petWindow.isDestroyed()) {
    return;
  }
  const now = Date.now();
  if (now - lastMenuPopupAt < MENU_POPUP_GUARD_MS) {
    return;
  }
  lastMenuPopupAt = now;

  const template: MenuItemConstructorOptions[] = [
    {
      label: tMain("pet.settings"),
      click: () => {
        openPetSettings();
      },
    },
    { type: "separator" },
    {
      label: tMain("pet.close"),
      click: () => {
        void closePet(native);
      },
    },
  ];

  // 不传坐标：菜单默认在鼠标当前位置弹出，与右键位置一致。
  Menu.buildFromTemplate(template).popup({ window: petWindow });
};

/** 刷新配置并按需创建/更新/关闭宠物窗口。 */
export const refreshPetWindow = async (native: NativeBridge): Promise<void> => {
  const settings = await loadPetSettings(native);
  const manifest = await resolveActiveManifest(native, settings);
  currentConfig = {
    settings,
    manifest,
    mode: currentMode,
    chatContext: getPetChatContext(),
    labels: buildChatLabels(),
  };

  const shouldShow = settings.enabled && manifest !== null;
  if (!shouldShow) {
    destroyPetWindow();
    broadcastPetsChanged();
    return;
  }

  if (!petWindow || petWindow.isDestroyed()) {
    createPetWindow(settings, native);
  } else if (currentMode === "sprite") {
    // 精灵形态：缩放设置变化时按原语义原地调整尺寸（保持左上角不动）；
    // 聊天形态尺寸固定，不随缩放变化。
    const { width, height } = computeWindowSize(settings.scale);
    const current = petWindow.getBounds();
    applyPetWindowBounds({ ...current, width, height });
  }

  broadcastConfig();
  broadcastState();
  broadcastPetsChanged();
};

const createPetWindow = (settings: PetSettings, native: NativeBridge): void => {
  const { width, height } = resolveModeSize(currentMode, settings);
  const { x, y } = resolveWakePosition(width, height);

  petWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    title: "Snow Pet",
    transparent: true,
    frame: false,
    resizable: false,
    movable: true, // 程序化 setPosition 需要；无边框窗口无 OS 拖拽入口
    alwaysOnTop: true,
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    roundedCorners: false,
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/pet.cjs"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  petWindow.setAlwaysOnTop(true, "screen-saver");
  // macOS 上 setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  // 存在 Electron/AppKit 已知 bug（electron#26350 / #36364）：与 alwaysOnTop
  // 组合时可能触发整个应用被系统隐藏（主窗口消失、Dock 图标消失）。
  // 因此 macOS 上仅启用跨 Space 可见（宠物不出现在全屏 Space 上），
  // 其它平台保留全屏可见能力。
  if (isMacOS) {
    petWindow.setVisibleOnAllWorkspaces(true);
  } else {
    petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  // 兜底：部分 macOS 版本上上述已知 bug 仍可能连带隐藏主窗口与宠物自身。
  // 仅当创建宠物前主窗口可见时才检测并恢复，避免误伤用户主动隐藏到托盘。
  const mainVisibleBefore = getMainWindow()?.isVisible() ?? false;
  petWindow.once("show", () => {
    if (!isMacOS || !mainVisibleBefore) {
      return;
    }
    setTimeout(() => {
      if (petWindow && !petWindow.isDestroyed() && !petWindow.isVisible()) {
        petWindow.show();
      }
      const mainWindow = getMainWindow();
      if (mainWindow && !mainWindow.isVisible()) {
        mainWindow.show();
        mainWindow.focus();
      }
      app.dock?.show();
    }, 200);
  });

  petWindow.once("ready-to-show", () => {
    petWindow?.show();
  });

  petWindow.on("closed", () => {
    petWindow = null;
  });

  // 屏蔽 Windows 系统窗口菜单（最大化/最小化/移动/关闭等，由非客户区
  // 右键或 Alt+Space 触发），改为弹出宠物自定义右键菜单。
  petWindow.on("system-context-menu", (event) => {
    event.preventDefault();
    showPetContextMenu(native);
  });

  // Alt+Space 走 WM_SYSCOMMAND（与右键的 WM_CONTEXTMENU 不同），
  // 无边框窗口仍会弹出系统菜单，需在输入层一并拦截。
  petWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.alt && input.key === " ") {
      event.preventDefault();
    }
  });

  // OS 级拖拽时渲染层收不到指针事件，改由窗口 move 事件推断移动方向，
  // 驱动左/右奔跑动画；停止移动一小段时间后回落到基础状态。
  let lastDragX: number | null = null;
  let dragIdleTimer: NodeJS.Timeout | null = null;
  petWindow.on("move", () => {
    if (!petWindow || petWindow.isDestroyed()) {
      return;
    }
    const [x] = petWindow.getPosition();
    if (lastDragX !== null && x !== lastDragX) {
      broadcastDragState(x > lastDragX ? "running-right" : "running-left");
      if (dragIdleTimer) {
        clearTimeout(dragIdleTimer);
      }
      dragIdleTimer = setTimeout(() => {
        dragIdleTimer = null;
        broadcastDragState(null);
      }, DRAG_DIRECTION_SETTLE_MS);
    }
    lastDragX = x;
  });

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    petWindow
      .loadURL(`${process.env.ELECTRON_RENDERER_URL}/pet.html`)
      .catch((error) => {
        snowLog.error({
          module: "pets/petWindow",
          func: "createPetWindow",
          message: "Failed to load pet renderer (dev)",
          error: error instanceof Error ? error.message : String(error),
        });
      });
  } else {
    petWindow
      .loadURL(
        pathToFileURL(
          join(import.meta.dirname, "../renderer/pet.html"),
        ).toString(),
      )
      .catch((error) => {
        snowLog.error({
          module: "pets/petWindow",
          func: "createPetWindow",
          message: "Failed to load pet renderer",
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }
};

/** 应用启动后调用：若宠物处于唤醒状态则恢复宠物窗口。 */
export const restorePetWindow = async (native: NativeBridge): Promise<void> => {
  try {
    await refreshPetWindow(native);
  } catch (error) {
    snowLog.warn({
      module: "pets/petWindow",
      func: "restorePetWindow",
      message: "Failed to restore pet window",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

/** 获取当前宠物配置（宠物窗口 preload 启动时拉取）。 */
export const getCurrentPetConfig = (): PetWindowConfig | null => currentConfig;

/**
 * 获取当前活动状态（宠物窗口 preload 启动时拉取）。
 * 先启动会话再唤醒宠物时，窗口创建时刻的广播页面尚未加载完成会丢失，
 * 宠物页面挂载后主动拉取一次以对齐真实状态。
 */
export const getCurrentPetActivity = (): PetActivityState => currentState;

// ── AI 活动状态联动 ─────────────────────────────────────────────────

/**
 * 登记回合发送方的销毁监听（每个 webContents 只登记一次）。
 * 渲染层崩溃 / 窗口关闭 / 热重载时，其名下所有回合自动回收，
 * 防止宠物永久卡在 busy。
 */
const watchTurnSender = (sender: WebContents): void => {
  if (watchedTurnSenders.has(sender.id)) {
    return;
  }
  const senderId = sender.id;
  watchedTurnSenders.add(senderId);
  sender.once("destroyed", () => {
    watchedTurnSenders.delete(senderId);
    let removed = false;
    for (const [turnId, turn] of activeTurns) {
      if (turn.senderId === senderId) {
        activeTurns.delete(turnId);
        removed = true;
      }
    }
    if (removed) {
      clearSettleTimer();
      applyState(resolveActivityState());
    }
  });
};

/** 一个 AI 回合（整条 agent loop）开始，turnId 由渲染层生成并全程持有。 */
export const reportPetTurnStarted = (
  sender: WebContents,
  turnId: string,
  kind: PetTurnKind,
): void => {
  watchTurnSender(sender);
  if (!activeTurns.has(turnId)) {
    activeTurns.set(turnId, { senderId: sender.id, kind });
  }
  clearSettleTimer();
  applyState(resolveActivityState());
};

/**
 * 一个 AI 回合彻底结束。failed=true 时宠物短暂播放失败动画。
 * 按 turnId 核销：未知 / 重复的 end 幂等忽略，多会话并行互不干扰。
 */
export const reportPetTurnEnded = (turnId: string, failed: boolean): void => {
  if (!activeTurns.delete(turnId)) {
    return;
  }
  clearSettleTimer();

  if (activeTurns.size > 0 || waitingCount > 0) {
    applyState(resolveActivityState());
    return;
  }

  if (failed) {
    applyState("error");
  } else {
    applyState("completed");
  }

  // 短暂展示结果状态后回落到 idle。
  settleTimer = setTimeout(() => {
    settleTimer = null;
    applyState(resolveActivityState());
  }, SETTLE_DELAY_MS);
};

/** AI 向用户提问的等待计数（宠物展示 waiting 动画）。 */
export const reportPetWaiting = (active: boolean): void => {
  waitingCount = Math.max(0, waitingCount + (active ? 1 : -1));
  clearSettleTimer();
  applyState(resolveActivityState());
};

/** 应用退出前清理。 */
export const disposePetWindow = (): void => {
  clearSettleTimer();
  destroyPetWindow();
};
