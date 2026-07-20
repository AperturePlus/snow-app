import type {
  ColorGroup,
  ThemePalette,
  ThemeSettings,
  ThemeMode,
} from "./types";
import { DEFAULT_THEME_PRESET_ID, getPresetById } from "./themePresets";

export const THEME_SETTING_NAME = "Theme settings";
export const THEME_SETTING_CODE = "theme_settings";

export const PALETTE_ROLE_TO_CSS_VAR: Record<keyof ThemePalette, string> = {
  bgPrimary: "--bg-primary",
  bgSecondary: "--bg-secondary",
  bgTertiary: "--bg-tertiary",
  bgHover: "--bg-hover",
  bgActive: "--bg-active",
  chromeBg: "--chrome-bg",
  appBg: "--app-bg",
  borderColor: "--border-color",
  borderLight: "--border-light",
  borderSubtle: "--border-subtle",
  textPrimary: "--text-primary",
  textSecondary: "--text-secondary",
  textTertiary: "--text-tertiary",
  textMuted: "--text-muted",
  accentGreen: "--accent-green",
  accentGreenBg: "--accent-green-bg",
  accentGreenText: "--accent-green-text",
  accentRed: "--accent-red",
  accentRedBg: "--accent-red-bg",
  accentRedText: "--accent-red-text",
  accentBlue: "--accent-blue",
  accentBlueBg: "--accent-blue-bg",
  accentBlueText: "--accent-blue-text",
  onSolid: "--on-solid",
  selectionBg: "--selection-bg",
  focusRing: "--focus-ring",
};

export const COLOR_GROUPS: ColorGroup[] = [
  {
    titleKey: "settings.themeGroupBackground",
    defaultTitle: "Background",
    roles: [
      {
        role: "bgPrimary",
        labelKey: "settings.themeColorBgPrimary",
        defaultLabel: "Primary background",
      },
      {
        role: "bgSecondary",
        labelKey: "settings.themeColorBgSecondary",
        defaultLabel: "Secondary background",
      },
      {
        role: "bgTertiary",
        labelKey: "settings.themeColorBgTertiary",
        defaultLabel: "Tertiary background",
      },
      {
        role: "bgHover",
        labelKey: "settings.themeColorBgHover",
        defaultLabel: "Hover background",
      },
      {
        role: "bgActive",
        labelKey: "settings.themeColorBgActive",
        defaultLabel: "Active background",
      },
      {
        role: "chromeBg",
        labelKey: "settings.themeColorChromeBg",
        defaultLabel: "Chrome background",
      },
      {
        role: "appBg",
        labelKey: "settings.themeColorAppBg",
        defaultLabel: "App background",
      },
    ],
  },
  {
    titleKey: "settings.themeGroupText",
    defaultTitle: "Text",
    roles: [
      {
        role: "textPrimary",
        labelKey: "settings.themeColorTextPrimary",
        defaultLabel: "Primary text",
      },
      {
        role: "textSecondary",
        labelKey: "settings.themeColorTextSecondary",
        defaultLabel: "Secondary text",
      },
      {
        role: "textTertiary",
        labelKey: "settings.themeColorTextTertiary",
        defaultLabel: "Tertiary text",
      },
      {
        role: "textMuted",
        labelKey: "settings.themeColorTextMuted",
        defaultLabel: "Muted text",
      },
      {
        role: "onSolid",
        labelKey: "settings.themeColorOnSolid",
        defaultLabel: "On solid",
      },
    ],
  },
  {
    titleKey: "settings.themeGroupBorder",
    defaultTitle: "Border",
    roles: [
      {
        role: "borderColor",
        labelKey: "settings.themeColorBorder",
        defaultLabel: "Border",
      },
      {
        role: "borderLight",
        labelKey: "settings.themeColorBorderLight",
        defaultLabel: "Light border",
      },
      {
        role: "borderSubtle",
        labelKey: "settings.themeColorBorderSubtle",
        defaultLabel: "Subtle border",
      },
    ],
  },
  {
    titleKey: "settings.themeGroupAccent",
    defaultTitle: "Accent colors",
    roles: [
      {
        role: "accentGreen",
        labelKey: "settings.themeColorAccentGreen",
        defaultLabel: "Green",
      },
      {
        role: "accentGreenBg",
        labelKey: "settings.themeColorAccentGreenBg",
        defaultLabel: "Green background",
      },
      {
        role: "accentGreenText",
        labelKey: "settings.themeColorAccentGreenText",
        defaultLabel: "Green text",
      },
      {
        role: "accentRed",
        labelKey: "settings.themeColorAccentRed",
        defaultLabel: "Red",
      },
      {
        role: "accentRedBg",
        labelKey: "settings.themeColorAccentRedBg",
        defaultLabel: "Red background",
      },
      {
        role: "accentRedText",
        labelKey: "settings.themeColorAccentRedText",
        defaultLabel: "Red text",
      },
      {
        role: "accentBlue",
        labelKey: "settings.themeColorAccentBlue",
        defaultLabel: "Blue",
      },
      {
        role: "accentBlueBg",
        labelKey: "settings.themeColorAccentBlueBg",
        defaultLabel: "Blue background",
      },
      {
        role: "accentBlueText",
        labelKey: "settings.themeColorAccentBlueText",
        defaultLabel: "Blue text",
      },
    ],
  },
  {
    titleKey: "settings.themeGroupOther",
    defaultTitle: "Other",
    roles: [
      {
        role: "selectionBg",
        labelKey: "settings.themeColorSelectionBg",
        defaultLabel: "Selection background",
      },
      {
        role: "focusRing",
        labelKey: "settings.themeColorFocusRing",
        defaultLabel: "Focus ring",
      },
    ],
  },
];

export const DEFAULT_THEME_SETTINGS: ThemeSettings = {
  mode: "system",
  presetId: DEFAULT_THEME_PRESET_ID,
  custom: {
    light: getPresetById(DEFAULT_THEME_PRESET_ID)?.light ?? emptyPalette(),
    dark: getPresetById(DEFAULT_THEME_PRESET_ID)?.dark ?? emptyPalette(),
  },
  background: {
    enabled: false,
    imagePath: "",
    opacity: 1,
    blur: 0,
  },
};

export function emptyPalette(): ThemePalette {
  return {
    bgPrimary: "",
    bgSecondary: "",
    bgTertiary: "",
    bgHover: "",
    bgActive: "",
    chromeBg: "",
    appBg: "",
    borderColor: "",
    borderLight: "",
    borderSubtle: "",
    textPrimary: "",
    textSecondary: "",
    textTertiary: "",
    textMuted: "",
    accentGreen: "",
    accentGreenBg: "",
    accentGreenText: "",
    accentRed: "",
    accentRedBg: "",
    accentRedText: "",
    accentBlue: "",
    accentBlueBg: "",
    accentBlueText: "",
    onSolid: "",
    selectionBg: "",
    focusRing: "",
  };
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const toText = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

export function normalizePalette(value: unknown): ThemePalette {
  const source = isRecord(value) ? value : {};
  const palette = emptyPalette();
  (Object.keys(palette) as (keyof ThemePalette)[]).forEach((key) => {
    palette[key] = toText(source[key]);
  });
  return palette;
}

export function normalizeCustomTheme(value: unknown): ThemeSettings["custom"] {
  const source = isRecord(value) ? value : {};
  return {
    light: normalizePalette(source.light),
    dark: normalizePalette(source.dark),
  };
}

export function normalizeThemeBackground(
  value: unknown
): ThemeSettings["background"] {
  const source = isRecord(value) ? value : {};
  const opacity =
    typeof source.opacity === "number" && Number.isFinite(source.opacity)
      ? Math.max(0, Math.min(1, source.opacity))
      : 1;
  const blur =
    typeof source.blur === "number" && Number.isFinite(source.blur)
      ? Math.max(0, Math.min(100, source.blur))
      : 0;
  return {
    enabled: typeof source.enabled === "boolean" ? source.enabled : false,
    imagePath: toText(source.imagePath),
    opacity,
    blur,
  };
}

export function normalizeThemeSettings(value: unknown): ThemeSettings {
  const source = isRecord(value) ? value : {};
  const rawMode = toText(source.mode) || "system";
  const mode: ThemeMode =
    rawMode === "light" || rawMode === "dark" ? rawMode : "system";
  const presetId = toText(source.presetId) || DEFAULT_THEME_PRESET_ID;
  return {
    mode,
    presetId,
    custom: normalizeCustomTheme(source),
    background: normalizeThemeBackground(source.background),
  };
}

export function resolveActivePalette(
  settings: ThemeSettings,
  isDark: boolean
): ThemePalette {
  const useCustom = settings.presetId === "custom";
  if (useCustom) {
    return isDark ? settings.custom.dark : settings.custom.light;
  }
  const preset = getPresetById(settings.presetId);
  if (preset) {
    return isDark ? preset.dark : preset.light;
  }
  const fallback = getPresetById(DEFAULT_THEME_PRESET_ID);
  return isDark
    ? fallback?.dark ?? settings.custom.dark
    : fallback?.light ?? settings.custom.light;
}

export function applyPaletteToDocument(palette: ThemePalette): void {
  const root = document.documentElement;
  (Object.keys(palette) as (keyof ThemePalette)[]).forEach((key) => {
    const cssVar = PALETTE_ROLE_TO_CSS_VAR[key];
    const value = palette[key];
    if (cssVar && value) {
      root.style.setProperty(cssVar, value);
    }
  });
}

export function applyThemeModeToDocument(mode: ThemeMode): "light" | "dark" {
  const prefersDark =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  const effective: "light" | "dark" =
    mode === "system" ? (prefersDark ? "dark" : "light") : mode;
  document.documentElement.setAttribute("data-theme", effective);
  document.documentElement.style.setProperty("color-scheme", effective);
  return effective;
}

export function isValidHex(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(trimmed);
}
