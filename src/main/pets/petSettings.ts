/**
 * 桌面宠物设置持久化。
 *
 * 所有设置通过 Rust 后端的 system_settings 表存取，以单个 JSON
 * （code = pet_settings）保存，与其他设置模块保持一致。
 *
 * 旧版本兼容：旧版本把 enabled / activePetId / scale 拆成
 * pet_enabled / pet_active_id / pet_scale 三个独立键值；读取时若
 * 新格式缺失则自动迁移（合并旧值 -> 写入新格式 -> 删除旧键）。
 *
 * 位置不做持久化：每次唤醒宠物都出现在固定的默认位置
 * （主显示器工作区右下角），避免上次拖拽后的坐标导致
 * 宠物出现在屏幕外而"找不到"。
 */
import type { NativeBridge } from "../native/types";

/** 宠物活动状态（驱动精灵图状态行切换）。 */
export type PetActivityState =
  "idle" | "busy" | "review" | "waiting" | "error" | "completed";

/** AI 回合类型：普通对话 / 代码审查（review 播放专属动画行）。 */
export type PetTurnKind = "chat" | "review";

/** 桌面宠物设置。 */
export type PetSettings = {
  /** 是否唤醒宠物（显示宠物窗口） */
  enabled: boolean;
  /** 当前激活的宠物 id（null 表示未选择） */
  activePetId: string | null;
  /** 显示缩放（0.5 ~ 2，默认 0.75） */
  scale: number;
  /** 动画播放速度倍率（0.5 ~ 2，默认 1） */
  speed: number;
  /** 宠物聊天使用的 API 配置名（null = 跟随当前激活配置） */
  apiProfile: string | null;
  /** 宠物聊天使用的模型 id（null = 跟随所选配置的高级模型） */
  model: string | null;
  /**
   * 宠物聊天人设自定义：宠物 id → 人设文本（空串表示恢复默认）。
   * 宠物聊天构建系统提示词时优先取这里，缺省回落宠物包 description。
   */
  personas: Record<string, string>;
};

const SETTING_NAME = "Pet settings";
const SETTING_CODE = "pet_settings";

// 旧版本拆分存储的独立键值 code，仅用于一次性迁移。
const LEGACY_CODES = {
  enabled: "pet_enabled",
  activeId: "pet_active_id",
  scale: "pet_scale",
} as const;

export const PET_SCALE_MIN = 0.5;
export const PET_SCALE_MAX = 2;
export const PET_SCALE_DEFAULT = 0.75;

export const PET_SPEED_MIN = 0.5;
export const PET_SPEED_MAX = 2;
export const PET_SPEED_DEFAULT = 1;

export const DEFAULT_PET_SETTINGS: PetSettings = {
  enabled: false,
  activePetId: null,
  scale: PET_SCALE_DEFAULT,
  speed: PET_SPEED_DEFAULT,
  apiProfile: null,
  model: null,
  personas: {},
};

const parseEnabled = (raw: unknown, fallback: boolean): boolean => {
  if (typeof raw === "boolean") {
    return raw;
  }
  if (raw === "1" || raw === "true") {
    return true;
  }
  if (raw === "0" || raw === "false") {
    return false;
  }
  return fallback;
};

const parseActivePetId = (raw: unknown): string | null => {
  const value = typeof raw === "string" ? raw.trim() : "";
  return value || null;
};

/** 可选字符串：空串 / 非字符串统一归一化为 null（表示「跟随默认」）。 */
const parseOptionalString = (raw: unknown): string | null => {
  const value = typeof raw === "string" ? raw.trim() : "";
  return value || null;
};

const parseClampedNumber = (
  raw: unknown,
  fallback: number,
  min: number,
  max: number,
): number => {
  const value =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number.parseFloat(raw)
        : Number.NaN;
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
};

/** 自定义人设单条文本上限（防止异常大的设置撑爆提示词）。 */
export const PET_PERSONA_MAX_CHARS = 4000;

/**
 * 归一化自定义人设表：仅保留「非空 id → 非空文本」，文本裁剪到上限；
 * 非法输入一律丢弃（返回空表）。
 */
const parsePersonas = (raw: unknown): Record<string, string> => {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const id = key.trim();
    const text = typeof value === "string" ? value.trim() : "";
    if (!id || !text) {
      continue;
    }
    result[id] = text.slice(0, PET_PERSONA_MAX_CHARS);
  }
  return result;
};

/** 任意输入归一化为合法 PetSettings（字段级容错）。 */
const normalizePetSettings = (value: unknown): PetSettings => {
  const source =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};

  return {
    enabled: parseEnabled(source.enabled, DEFAULT_PET_SETTINGS.enabled),
    activePetId: parseActivePetId(source.activePetId),
    scale: parseClampedNumber(
      source.scale,
      PET_SCALE_DEFAULT,
      PET_SCALE_MIN,
      PET_SCALE_MAX,
    ),
    speed: parseClampedNumber(
      source.speed,
      PET_SPEED_DEFAULT,
      PET_SPEED_MIN,
      PET_SPEED_MAX,
    ),
    apiProfile: parseOptionalString(source.apiProfile),
    model: parseOptionalString(source.model),
    personas: parsePersonas(source.personas),
  };
};

/** 旧版本迁移：读拆分键值合并为新格式，写回后清理旧键。 */
const migrateLegacySettings = async (
  native: NativeBridge,
): Promise<PetSettings> => {
  const [enabledRaw, activeIdRaw, scaleRaw] = await Promise.all([
    native.getSystemSettingValue(LEGACY_CODES.enabled),
    native.getSystemSettingValue(LEGACY_CODES.activeId),
    native.getSystemSettingValue(LEGACY_CODES.scale),
  ]);

  if (enabledRaw === null && activeIdRaw === null && scaleRaw === null) {
    return { ...DEFAULT_PET_SETTINGS };
  }

  const merged: PetSettings = {
    enabled:
      enabledRaw !== null
        ? parseEnabled(enabledRaw, DEFAULT_PET_SETTINGS.enabled)
        : DEFAULT_PET_SETTINGS.enabled,
    activePetId: parseActivePetId(activeIdRaw),
    scale:
      scaleRaw !== null
        ? parseClampedNumber(
            scaleRaw,
            PET_SCALE_DEFAULT,
            PET_SCALE_MIN,
            PET_SCALE_MAX,
          )
        : PET_SCALE_DEFAULT,
    speed: PET_SPEED_DEFAULT,
    apiProfile: DEFAULT_PET_SETTINGS.apiProfile,
    model: DEFAULT_PET_SETTINGS.model,
    personas: {},
  };

  await savePetSettings(native, merged);
  try {
    // 清理失败不阻断：下次读取直接命中新格式，旧键不再参与。
    await Promise.all([
      native.deleteSystemSetting(LEGACY_CODES.enabled),
      native.deleteSystemSetting(LEGACY_CODES.activeId),
      native.deleteSystemSetting(LEGACY_CODES.scale),
    ]);
  } catch {
    // 忽略清理错误
  }
  return merged;
};

/** 读取完整的宠物设置（新格式缺失时自动迁移旧版本数据）。 */
export const loadPetSettings = async (
  native: NativeBridge,
): Promise<PetSettings> => {
  try {
    const raw = await native.getSystemSettingValue(SETTING_CODE);
    if (raw !== null && raw.trim()) {
      try {
        return normalizePetSettings(JSON.parse(raw));
      } catch {
        // 新格式损坏：丢弃并走迁移/默认值
      }
    }
    return await migrateLegacySettings(native);
  } catch {
    return { ...DEFAULT_PET_SETTINGS };
  }
};

/** 将完整宠物设置作为单个 JSON 写入。 */
export const savePetSettings = async (
  native: NativeBridge,
  settings: PetSettings,
): Promise<PetSettings> => {
  const normalized = normalizePetSettings(settings);
  await native.setSystemSetting(
    SETTING_NAME,
    SETTING_CODE,
    JSON.stringify(normalized),
  );
  return normalized;
};
