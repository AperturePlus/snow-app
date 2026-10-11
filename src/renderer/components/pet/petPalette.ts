/**
 * 宠物取色：从精灵图采样，生成聊天窗口的配色。
 *
 * 做法：把整张精灵图等比缩到小画布（覆盖全部动作行，颜色更具代表性），
 * 跳过透明像素求平均色，再按 HSL 推导出「表面 / 描边 / 文本 / 强调色」。
 * 整体色相来自宠物自身；面板明暗取宠物平均色的对比侧，既保证文字对比度，
 * 也让作为聊天窗口背景图的宠物清晰可见。
 */
import type { CSSProperties } from "react";
import { themeBgUrl } from "../../utils/themeBgUrl";

export type PetPalette = {
  accent: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  textMuted: string;
  border: string;
  userBubble: string;
  userBubbleText: string;
  /** 滚动条滑块三态（对齐主应用 styles.css 的全局滚动条设定）。 */
  scrollbarThumb: string;
  scrollbarThumbHover: string;
  scrollbarThumbActive: string;
};

/** 取色失败时的兜底配色（中性深色）。 */
export const FALLBACK_PET_PALETTE: PetPalette = {
  accent: "rgba(138, 141, 255, 0.92)",
  surface: "rgba(28, 28, 40, 0.88)",
  surfaceAlt: "rgba(40, 40, 56, 0.94)",
  text: "rgba(246, 246, 255, 0.96)",
  textMuted: "rgba(198, 198, 220, 0.78)",
  border: "rgba(138, 141, 255, 0.34)",
  userBubble: "rgba(138, 141, 255, 0.9)",
  userBubbleText: "rgba(18, 18, 28, 0.96)",
  scrollbarThumb: "rgba(148, 163, 184, 0.58)",
  scrollbarThumbHover: "rgba(100, 116, 139, 0.78)",
  scrollbarThumbActive: "rgba(71, 85, 105, 0.9)",
};

/** 采样画布宽度（精灵图等比缩放，高度按比例）。 */
const SAMPLE_WIDTH = 64;
/** 视为「不透明」的 alpha 阈值。 */
const OPAQUE_ALPHA = 32;

type Hsl = { h: number; s: number; l: number };

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const hsl = (h: number, s: number, l: number, alpha = 1): string =>
  `hsla(${Math.round(h)}, ${Math.round(clamp(s, 0, 1) * 100)}%, ${Math.round(
    clamp(l, 0, 1) * 100,
  )}%, ${alpha})`;

const rgbToHsl = (r: number, g: number, b: number): Hsl => {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) {
    return { h: 210, s: 0, l };
  }
  const s = delta / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) {
    h = ((gn - bn) / delta) % 6;
  } else if (max === gn) {
    h = (bn - rn) / delta + 2;
  } else {
    h = (rn - gn) / delta + 4;
  }
  return { h: (h * 60 + 360) % 360, s, l };
};

/**
 * 从 RGB 平均色推导完整面板配色。
 *
 * 面板明暗取「宠物平均色的对比侧」：浅色宠物配深色卡片、深色宠物配浅色卡片。
 * 色相仍取自宠物本身（保持身份感），但明度刻意拉开，使作为背景图的宠物
 * 在面板上有足够对比度（同侧取色会让浅色宠物在浅色面板上糊成一片）。
 */
const buildPalette = (r: number, g: number, b: number): PetPalette => {
  const { h, s, l } = rgbToHsl(r, g, b);
  // 相对亮度（sRGB 感知权重）决定宠物偏亮还是偏暗。
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const petIsLight = luminance > 140;
  const accent = hsl(h, Math.max(s, 0.55), clamp(l, 0.48, 0.64));

  if (petIsLight) {
    // 浅色宠物 → 深色面板 + 浅色文字。
    return {
      accent,
      surface: hsl(h, 0.34, 0.13, 0.88),
      surfaceAlt: hsl(h, 0.32, 0.2, 0.93),
      text: hsl(h, 0.24, 0.97, 0.96),
      textMuted: hsl(h, 0.16, 0.76, 0.8),
      border: hsl(h, 0.32, 0.4, 0.5),
      userBubble: accent,
      userBubbleText: hsl(h, 0.42, 0.12, 0.96),
      scrollbarThumb: hsl(h, 0.16, 0.78, 0.36),
      scrollbarThumbHover: hsl(h, 0.16, 0.84, 0.58),
      scrollbarThumbActive: hsl(h, 0.16, 0.92, 0.78),
    };
  }

  // 深色宠物 → 浅色面板 + 深色文字。
  return {
    accent,
    surface: hsl(h, 0.42, 0.96, 0.9),
    surfaceAlt: hsl(h, 0.38, 0.91, 0.95),
    text: hsl(h, 0.4, 0.15, 0.96),
    textMuted: hsl(h, 0.22, 0.36, 0.85),
    border: hsl(h, 0.34, 0.62, 0.55),
    userBubble: hsl(h, 0.62, 0.4, 0.92),
    userBubbleText: hsl(h, 0.3, 0.98, 0.98),
    scrollbarThumb: hsl(h, 0.2, 0.42, 0.32),
    scrollbarThumbHover: hsl(h, 0.22, 0.34, 0.52),
    scrollbarThumbActive: hsl(h, 0.24, 0.26, 0.72),
  };
};

/**
 * 采样精灵图并生成配色。任何失败（加载失败、canvas 受限）都回退到中性配色，
 * 不阻断宠物窗口渲染。
 */
export const extractPetPalette = async (
  spritesheetPath: string,
): Promise<PetPalette> => {
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Pet spritesheet load failed"));
      element.src = themeBgUrl(spritesheetPath);
    });

    const sampleHeight = Math.max(
      1,
      Math.round((image.naturalHeight / image.naturalWidth) * SAMPLE_WIDTH),
    );
    const canvas = document.createElement("canvas");
    canvas.width = SAMPLE_WIDTH;
    canvas.height = sampleHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      return FALLBACK_PET_PALETTE;
    }
    ctx.drawImage(image, 0, 0, SAMPLE_WIDTH, sampleHeight);
    const data = ctx.getImageData(0, 0, SAMPLE_WIDTH, sampleHeight).data;

    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < OPAQUE_ALPHA) {
        continue;
      }
      sumR += data[i];
      sumG += data[i + 1];
      sumB += data[i + 2];
      count += 1;
    }
    if (count === 0) {
      return FALLBACK_PET_PALETTE;
    }

    return buildPalette(sumR / count, sumG / count, sumB / count);
  } catch {
    return FALLBACK_PET_PALETTE;
  }
};

/** 把配色转成容器上的 CSS 变量（自定义属性不在 CSSProperties 已知字段内）。 */
export const paletteToCssVars = (palette: PetPalette): CSSProperties => {
  const vars: Record<string, string> = {
    "--pet-accent": palette.accent,
    "--pet-surface": palette.surface,
    "--pet-surface-alt": palette.surfaceAlt,
    "--pet-text": palette.text,
    "--pet-text-muted": palette.textMuted,
    "--pet-border": palette.border,
    "--pet-user-bubble": palette.userBubble,
    "--pet-user-bubble-text": palette.userBubbleText,
    // 主应用全局滚动条使用的同名语义变量，这里由宠物取色填充。
    "--scrollbar-thumb": palette.scrollbarThumb,
    "--scrollbar-thumb-hover": palette.scrollbarThumbHover,
    "--scrollbar-thumb-active": palette.scrollbarThumbActive,
  };
  return vars as CSSProperties;
};
