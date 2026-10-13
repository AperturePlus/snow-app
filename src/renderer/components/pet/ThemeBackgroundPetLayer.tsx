/**
 * 宠物背景层：把所选宠物的 idle 动画铺在界面最上层作为动态背景。
 *
 * 来源 / 宠物 / 启用状态来自主题设置，或设置面板派发的实时预览事件；
 * 不透明度、模糊、宠物大小直接读取 :root 上的 CSS 变量，因此拖动滑块
 * 无需 React 重渲染即可即时生效；播放速度跟随「桌面宠物」设置的速度倍率。
 */
import { useEffect, useRef, useState } from "react";
import type { PetManifest } from "../../../preload/types/pets";
import type { ThemeBackground } from "../sidebar/themeSettings/types";
import { themeBgUrl } from "../../utils/themeBgUrl";
import {
  PET_STATE_FPS,
  PET_STATE_ROWS,
  prepareSpritesheet,
  type PreparedSpritesheet,
} from "./petSprites";

/** 设置面板实时预览事件：detail 为表单中的背景配置。 */
export const THEME_BG_PREVIEW_EVENT = "theme:bg-preview";
/** 宠物背景大小变量（相对视口高度的比例）。 */
const PET_SCALE_VAR = "--theme-pet-scale";
const DEFAULT_PET_SCALE = 0.6;

type ThemeBackgroundPetLayerProps = {
  background: ThemeBackground;
};

export function ThemeBackgroundPetLayer({
  background,
}: ThemeBackgroundPetLayerProps): React.JSX.Element | null {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sheetRef = useRef<PreparedSpritesheet | null>(null);
  // 播放速度倍率：跟随「桌面宠物」设置，主循环逐帧读取，避免重建动画循环。
  const speedRef = useRef(1);
  const [preview, setPreview] = useState<ThemeBackground | null>(null);
  const [pets, setPets] = useState<PetManifest[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);

  const effective = preview ?? background;
  const petId = effective.source === "pet" ? effective.petId : "";
  const manifest = pets.find((pet) => pet.id === petId) ?? null;
  const active = effective.enabled && Boolean(manifest);

  // 实时预览：面板改动背景配置时立即切换来源 / 宠物，不必等待持久化。
  useEffect(() => {
    const handlePreview = (event: Event): void => {
      const detail = (event as CustomEvent<ThemeBackground>).detail;
      if (detail && typeof detail === "object") {
        setPreview(detail);
      }
    };
    window.addEventListener(THEME_BG_PREVIEW_EVENT, handlePreview);
    return () => {
      window.removeEventListener(THEME_BG_PREVIEW_EVENT, handlePreview);
    };
  }, []);

  // 已安装宠物列表 + 宠物设置：petId → 精灵图路径，速度倍率 → 播放速度。
  // 未使用宠物背景时不读取宠物目录，避免启动时无谓的磁盘扫描。
  useEffect(() => {
    if (!petId) {
      setPets((previous) => (previous.length === 0 ? previous : []));
      return;
    }
    let cancelled = false;
    const reload = (): void => {
      void window.snow
        .listInstalledPets()
        .then((list) => {
          if (!cancelled) {
            setPets(list);
          }
        })
        .catch(() => undefined);
      void window.snow
        .getPetSettings()
        .then((settings) => {
          if (!cancelled) {
            speedRef.current = settings.speed;
          }
        })
        .catch(() => undefined);
    };
    reload();
    const unsubscribe = window.snow.onPetsChanged(reload);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [petId]);

  // 精灵图加载与预处理（品红抠图 + 逐行帧数检测）。
  useEffect(() => {
    sheetRef.current = null;
    setLoadFailed(false);
    if (!manifest) {
      return;
    }
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled) {
        return;
      }
      try {
        const columns = manifest.columns > 0 ? manifest.columns : 8;
        const rows = manifest.rows > 0 ? manifest.rows : 9;
        sheetRef.current = prepareSpritesheet(image, columns, rows);
      } catch {
        setLoadFailed(true);
      }
    };
    image.onerror = () => {
      if (!cancelled) {
        setLoadFailed(true);
      }
    };
    image.src = themeBgUrl(manifest.spritesheetPath);
    return () => {
      cancelled = true;
    };
  }, [manifest]);

  // 绘制循环：idle 行循环播放，画布随窗口尺寸变化重建。
  useEffect(() => {
    if (!active || loadFailed) {
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    const resize = (): void => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(window.innerWidth * dpr));
      canvas.height = Math.max(1, Math.round(window.innerHeight * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    let rafId = 0;
    let lastTime: number | null = null;
    let frameFloat = 0;
    let lastKey = "";

    const loop = (now: number): void => {
      rafId = requestAnimationFrame(loop);
      const delta = lastTime === null ? 0 : (now - lastTime) / 1000;
      lastTime = now;

      const sheet = sheetRef.current;
      if (!sheet) {
        return;
      }
      const row = PET_STATE_ROWS.idle;
      const frameCount = sheet.frameCounts[row] ?? 1;
      // 播放速度跟随「桌面宠物」设置的速度倍率。
      const fps = PET_STATE_FPS.idle * (speedRef.current || 1);
      frameFloat = (frameFloat + delta * fps) % frameCount;

      // 大小以 CSS 变量为准：拖动滑块时无需重建循环即可即时变化。
      const rawScale = Number.parseFloat(
        document.documentElement.style.getPropertyValue(PET_SCALE_VAR),
      );
      const scale =
        Number.isFinite(rawScale) && rawScale > 0
          ? rawScale
          : DEFAULT_PET_SCALE;
      const width = window.innerWidth;
      const height = window.innerHeight;
      // 帧未变、尺寸未变时跳过重绘（idle 仅 6 fps，无需每帧重画）。
      const key = `${Math.floor(frameFloat)}|${scale}|${width}x${height}|${canvas.width}x${canvas.height}`;
      if (key === lastKey) {
        return;
      }
      lastKey = key;

      const drawHeight = height * scale;
      const drawWidth = drawHeight * (sheet.frameWidth / sheet.frameHeight);

      ctx.clearRect(0, 0, width, height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        sheet.canvas,
        Math.floor(frameFloat) * sheet.frameWidth,
        row * sheet.frameHeight,
        sheet.frameWidth,
        sheet.frameHeight,
        (width - drawWidth) / 2,
        (height - drawHeight) / 2,
        drawWidth,
        drawHeight,
      );
    };

    rafId = requestAnimationFrame(loop);
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
    };
  }, [active, manifest, loadFailed]);

  if (!active || loadFailed) {
    return null;
  }

  return <canvas ref={canvasRef} className="theme-bg-pet-layer" />;
}
