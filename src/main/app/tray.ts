import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  Tray,
  type NativeImage,
} from "electron";
import { deflateSync, inflateSync } from "node:zlib";
import { readFileSync } from "node:fs";
import type { NativeBridge } from "../native/types";
import { APP_FAVICON_16_PATH, APP_FAVICON_32_PATH, APP_ICON_PATH } from "./constants";
import { createWindow, markCloseConfirmed } from "./mainWindow";
import { getActivePtyCount } from "../pty/ptyManager";
import { snowLog } from "../../utils/snowLogger";

/**
 * 系统托盘模块。
 *
 * 图标：
 * - macOS：黑白脱色单色模板图标（纯黑 + alpha，系统自动反色适配明暗菜单栏），
 *   由像素级绘制雪片 + 内置 PNG 编码器在运行时生成，零外部资源依赖。
 * - Windows/Linux：应用彩色 favicon 小图（16px + 32px @2x 双表示，DPI 精确匹配）。
 * - 活动态（有会话进行中）：Windows/Linux 右下角叠加绿色圆点，
 *   macOS 模板图加实心圆点，提醒后台仍有任务在跑。
 *
 * 悬停 tooltip（emoji 美化）展示快速信息：
 * 进行中会话 / 活跃终端 / 项目 / 待办备忘录 / 今日 Token 用量。
 *
 * 数据来源：进行中会话由渲染进程 IPC 推送；其余指标由主进程定时
 * 通过 Rust 后端异步查询（native bridge 已做 storageReady 门控，不阻塞）。
 */

// ─── 最小 PNG 编解码器（nativeImage 只可靠支持 PNG/JPEG）─────────────────

const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (buf: Uint8Array): number => {
  let c = 0xffffffff;
  for (const byte of buf) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
};

const pngChunk = (type: string, data: Uint8Array): Buffer => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
};

/** 将 RGBA 像素编码为标准 PNG（8bit、非隔行），供 nativeImage.createFromBuffer 使用。 */
const encodePng = (rgba: Uint8Array, width: number, height: number): Buffer => {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  // 其余（压缩/滤波/隔行）保持 0

  // 每行前加 1 字节滤波类型（0 = None），行内为 RGBA 像素
  const stride = width * 4;
  const raw = Buffer.alloc(height * (1 + stride));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + stride)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(
      raw,
      y * (1 + stride) + 1
    );
  }
  const idat = deflateSync(raw);
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
};

const paethPredictor = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
};

/**
 * 解码标准 PNG（8bit、非隔行，RGB/RGBA）为 RGBA 像素数组。
 * 仅用于解码托盘 favicon 以叠加活动角标；其他格式返回 null。
 */
const decodePng = (
  buffer: Buffer
): { width: number; height: number; rgba: Uint8Array } | null => {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(signature)) {
    return null;
  }

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks: Buffer[] = [];

  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR" && data.length >= 13) {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idatChunks.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }

  // 仅支持 8bit、非隔行（interlace 字段为 0）、RGB(2)/RGBA(6)
  if (
    width === 0 ||
    height === 0 ||
    bitDepth !== 8 ||
    (colorType !== 2 && colorType !== 6)
  ) {
    return null;
  }

  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idatChunks));
  const rgba = new Uint8Array(width * height * 4);

  // 逐行还原滤波：up/upLeft 必须取上一行"还原后"的像素，
  // 而非原始压缩行数据（否则 Up/Average/Paeth 滤波行会解出错误颜色）。
  let prevLine = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (1 + stride)];
    const rowStart = y * (1 + stride) + 1;
    const line = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const rawByte = raw[rowStart + x];
      const left = x >= channels ? line[x - channels] : 0;
      const up = prevLine[x];
      const upLeft = x >= channels ? prevLine[x - channels] : 0;
      let value = rawByte;
      switch (filter) {
        case 1:
          value = (rawByte + left) & 0xff;
          break;
        case 2:
          value = (rawByte + up) & 0xff;
          break;
        case 3:
          value = (rawByte + ((left + up) >> 1)) & 0xff;
          break;
        case 4:
          value = (rawByte + paethPredictor(left, up, upLeft)) & 0xff;
          break;
        default:
          break;
      }
      line[x] = value;
    }
    for (let x = 0; x < width; x++) {
      const out = (y * width + x) * 4;
      rgba[out] = line[x * channels];
      rgba[out + 1] = line[x * channels + 1];
      rgba[out + 2] = line[x * channels + 2];
      rgba[out + 3] = channels === 4 ? line[x * channels + 3] : 255;
    }
    prevLine = line;
  }

  return { width, height, rgba };
};

/** 在 RGBA 像素右下角叠加一个实心圆点（活动指示）。 */
const overlayActivityDot = (
  rgba: Uint8Array,
  width: number,
  height: number
): void => {
  const cx = width - 3.6;
  const cy = height - 3.6;
  const radius = 3.1;
  const dot = [34, 197, 94, 255]; // 绿色，与主题 accentGreen 一致
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d <= radius) {
        const idx = (y * width + x) * 4;
        rgba[idx] = dot[0];
        rgba[idx + 1] = dot[1];
        rgba[idx + 2] = dot[2];
        rgba[idx + 3] = dot[3];
      }
    }
  }
};

// ─── 图标生成 ─────────────────────────────────────────────────────────────

const TEMPLATE_ICON_SIZE = 16;

/** 点到线段的距离。 */
const distToSegment = (
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number => {
  const vx = x2 - x1;
  const vy = y2 - y1;
  const wx = px - x1;
  const wy = py - y1;
  const c2 = vx * vx + vy * vy;
  const t = c2 === 0 ? 0 : Math.min(1, Math.max(0, (vx * wx + vy * wy) / c2));
  return Math.hypot(px - (x1 + t * vx), py - (y1 + t * vy));
};

/** 像素级绘制雪片掩码：三条直径 + 每条臂两处短枝。 */
const drawSnowflakeMask = (size: number): boolean[] => {
  const mask = new Array<boolean>(size * size).fill(false);
  const c = size / 2;
  const r = c - 1.2;
  const segments: Array<[number, number, number, number]> = [];
  for (const angleDeg of [0, 60, 120]) {
    const rad = (angleDeg * Math.PI) / 180;
    const dx = Math.cos(rad);
    const dy = Math.sin(rad);
    // 直径
    segments.push([c, c, c + dx * r, c + dy * r]);
    segments.push([c, c, c - dx * r, c - dy * r]);
    // 每侧两处短枝（与臂成 ±60°）
    for (const d of [r * 0.55, r * 0.95]) {
      const branch = 1.7;
      const b1x = Math.cos(rad + Math.PI / 3) * branch;
      const b1y = Math.sin(rad + Math.PI / 3) * branch;
      const b2x = Math.cos(rad - Math.PI / 3) * branch;
      const b2y = Math.sin(rad - Math.PI / 3) * branch;
      const px = c + dx * d;
      const py = c + dy * d;
      const mx = c - dx * d;
      const my = c - dy * d;
      segments.push(
        [px, py, px + b1x, py + b1y],
        [px, py, px + b2x, py + b2y],
        [mx, my, mx + b1x, my + b1y],
        [mx, my, mx + b2x, my + b2y]
      );
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      for (const seg of segments) {
        if (distToSegment(px, py, ...seg) <= 1.05) {
          mask[y * size + x] = true;
          break;
        }
      }
    }
  }
  return mask;
};

/** 在掩码右下角绘制实心圆点（活动指示，模板图下为纯黑圆点）。 */
const drawActivityDot = (mask: boolean[], size: number): void => {
  const cx = size - 3.6;
  const cy = size - 3.6;
  const radius = 3.1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= radius) {
        mask[y * size + x] = true;
      }
    }
  }
};

/** macOS 模板图：纯黑 + alpha，系统菜单栏自动反色适配明暗。active 时带活动圆点。 */
const createMacTemplateIcon = (active: boolean): NativeImage => {
  const size = TEMPLATE_ICON_SIZE;
  const mask = drawSnowflakeMask(size);
  if (active) {
    drawActivityDot(mask, size);
  }
  const rgba = new Uint8Array(size * size * 4);
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) {
      rgba[i * 4 + 3] = 255; // 黑色通道保持 0
    }
  }
  const image = nativeImage.createFromBuffer(encodePng(rgba, size, size));
  image.setTemplateImage(true);
  return image;
};

/** 构建 Windows 双表示图标：16px @1x + 32px @2x，DPI 精确匹配。 */
const buildDualRepIcon = (icon16: NativeImage, icon32: NativeImage): NativeImage => {
  icon16.addRepresentation({
    scaleFactor: 2,
    width: 32,
    height: 32,
    buffer: icon32.toPNG(),
  });
  return icon16;
};

/** 从 PNG 文件叠加活动圆点（解码 → 画点 → 重编码）。直接读磁盘原始 PNG，避免 toPNG() 的预乘 alpha。 */
const withActivityDot = (pngPath: string): NativeImage => {
  try {
    const decoded = decodePng(readFileSync(pngPath));
    if (!decoded) {
      return nativeImage.createFromPath(pngPath);
    }
    overlayActivityDot(decoded.rgba, decoded.width, decoded.height);
    return nativeImage.createFromBuffer(
      encodePng(decoded.rgba, decoded.width, decoded.height)
    );
  } catch {
    return nativeImage.createFromPath(pngPath);
  }
};

/** Windows/Linux 彩色图标（正常 + 活动两套），使用设计好的 favicon 小图。 */
const createColorIcons = (): { normal: NativeImage; active: NativeImage } => {
  if (process.platform === "win32") {
    const icon16 = nativeImage.createFromPath(APP_FAVICON_16_PATH);
    const icon32 = nativeImage.createFromPath(APP_FAVICON_32_PATH);
    if (!icon16.isEmpty() && !icon32.isEmpty()) {
      return {
        normal: buildDualRepIcon(icon16, icon32),
        active: buildDualRepIcon(
          withActivityDot(APP_FAVICON_16_PATH),
          withActivityDot(APP_FAVICON_32_PATH)
        ),
      };
    }
  }

  // Linux（托盘惯例 22px）与回退路径：从 32px 源缩放，比从 256px 缩放更清晰。
  const icon32 = nativeImage.createFromPath(APP_FAVICON_32_PATH);
  const base = icon32.isEmpty()
    ? nativeImage.createFromPath(APP_ICON_PATH)
    : icon32;
  const target = process.platform === "linux" ? 22 : 16;
  const normal = base.resize({ width: target, height: target });
  const active = withActivityDot(APP_FAVICON_32_PATH).resize({
    width: target,
    height: target,
  });
  return { normal, active: active.isEmpty() ? normal : active };
};

// ─── 托盘状态 ─────────────────────────────────────────────────────────────

const STATS_REFRESH_MS = 15_000;

type TrayStats = {
  activeSessions: number;
  activeTerminals: number;
  projects: number;
  pendingMemos: number;
  todayTokens: number;
};

let tray: Tray | null = null;
let nativeBridge: NativeBridge | null = null;
let icons: { normal: NativeImage; active: NativeImage } | null = null;
let stats: TrayStats = {
  activeSessions: 0,
  activeTerminals: 0,
  projects: 0,
  pendingMemos: 0,
  todayTokens: 0,
};

const formatTokens = (count: number): string => {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}k`;
  }
  return String(count);
};

// 显示主窗口：恢复最小化、隐藏（托盘）状态并聚焦；窗口已全部关闭（macOS）时重建。
const showMainWindow = (): void => {
  // macOS 从菜单栏托盘恢复时，重新显示 Dock 图标。
  if (process.platform === "darwin") {
    app.dock?.show();
  }
  const windows = BrowserWindow.getAllWindows();
  if (windows.length > 0) {
    const win = windows[0];
    if (win.isMinimized()) {
      win.restore();
    }
    win.show();
    win.focus();
    return;
  }
  // macOS 上关闭 Dock 图标后窗口可能已全部销毁，此时从托盘重建窗口。
  createWindow();
};

const applyTooltip = (): void => {
  if (!tray) {
    return;
  }
  // 托盘 tooltip 是主进程原生纯文本，无法渲染 lucide 图标，保持简洁文本。
  const lines = [
    "Snow App",
    `会话进行中 ${stats.activeSessions}`,
    `活跃终端 ${stats.activeTerminals}`,
    `项目 ${stats.projects}`,
    `待办备忘录 ${stats.pendingMemos}`,
    `今日用量 ${formatTokens(stats.todayTokens)}`,
  ];
  tray.setToolTip(lines.join("\n"));
};

/** 根据是否有进行中会话切换托盘图标（活动态角标）。 */
const applyActiveVisual = (): void => {
  if (!tray || !icons) {
    return;
  }
  tray.setImage(stats.activeSessions > 0 ? icons.active : icons.normal);
};

// 通过 Rust 后端异步聚合全部指标（目录、备忘录、用量均走 native bridge）。
const refreshAllStats = (native: NativeBridge): void => {
  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  // Rust 端对 usage 使用 SQLite datetime 字符串比较，需带时间部分，
  // 否则 "YYYY-MM-DD HH:MM:SS" 格式的 created_at 无法匹配纯日期边界。
  const dayStart = `${dateStr} 00:00:00`;
  const dayEnd = `${dateStr} 23:59:59`;

  void (async () => {
    try {
      const [directories, usage] = await Promise.all([
        native.listWorkspaceDirectories(),
        native.getUsageSummary(dayStart, dayEnd),
      ]);
      const memoResults = await Promise.allSettled(
        directories.map((d) => native.getMemoCountSummary(d.directoryId))
      );
      stats = {
        activeSessions: stats.activeSessions,
        activeTerminals: getActivePtyCount(),
        projects: directories.length,
        pendingMemos: memoResults.reduce(
          (sum, r) => sum + (r.status === "fulfilled" ? r.value.pending : 0),
          0
        ),
        todayTokens: usage?.totalTokens ?? 0,
      };
      applyTooltip();
      applyActiveVisual();
    } catch (error) {
      snowLog.warn({
        module: "app/tray",
        func: "refreshAllStats",
        message: "Failed to refresh tray tooltip stats",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })();
};

/** 供其他模块（如隐藏到托盘时）触发一次立即刷新。 */
export const refreshTrayStats = (): void => {
  if (nativeBridge) {
    refreshAllStats(nativeBridge);
  }
};

const buildContextMenu = (): Menu => {
  return Menu.buildFromTemplate([
    { label: "打开 Snow App", click: showMainWindow },
    { type: "separator" },
    {
      label: "退出",
      click: () => {
        markCloseConfirmed();
        app.quit();
      },
    },
  ]);
};

export const initTray = (native: NativeBridge): void => {
  try {
    nativeBridge = native;
    const isMacOS = process.platform === "darwin";
    icons = isMacOS
      ? {
          normal: createMacTemplateIcon(false),
          active: createMacTemplateIcon(true),
        }
      : createColorIcons();

    tray = new Tray(icons.normal);
    tray.setToolTip("Snow App");
    tray.on("click", showMainWindow);

    if (isMacOS) {
      // macOS 左键点击恢复窗口，右键弹出菜单（避免左键被菜单吞掉）。
      tray.on("right-click", () => {
        tray?.popUpContextMenu(buildContextMenu());
      });
    } else {
      // Windows/Linux：右键默认弹出菜单。
      tray.setContextMenu(buildContextMenu());
    }

    // 渲染进程推送进行中会话数（渲染层是流式状态的唯一持有者）。
    ipcMain.handle("tray:set-active-sessions", (_event, count: unknown) => {
      if (typeof count === "number" && Number.isFinite(count)) {
        stats = { ...stats, activeSessions: Math.max(0, Math.floor(count)) };
        applyTooltip();
        applyActiveVisual();
      }
    });

    refreshAllStats(native);
    // 定时刷新指标（进程生命周期内常驻，随进程退出自动清理）。
    setInterval(() => refreshAllStats(native), STATS_REFRESH_MS);

    snowLog.info({
      module: "app/tray",
      func: "initTray",
      message: "System tray initialized",
      context: `platform=${process.platform}`,
    });
  } catch (error) {
    snowLog.warn({
      module: "app/tray",
      func: "initTray",
      message: "Failed to initialize system tray",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
