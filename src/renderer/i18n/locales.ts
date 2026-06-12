import { en } from "./lang/en";
import { zhCN } from "./lang/zh-CN";
import { zhTW } from "./lang/zh-TW";

export const SUPPORTED_LOCALES = ["en", "zh-CN", "zh-TW"] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_STORAGE_KEY = "snow.locale";

export const localeLabels: Record<Locale, string> = {
  en: "English",
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
};

export const resources: Record<Locale, Record<string, string>> = {
  en,
  "zh-CN": zhCN,
  "zh-TW": zhTW,
};

export const isSupportedLocale = (
  value: string | null | undefined
): value is Locale => {
  return SUPPORTED_LOCALES.some((locale) => locale === value);
};

export const normalizeLocale = (
  value: string | null | undefined
): Locale | null => {
  if (!value) {
    return null;
  }

  if (isSupportedLocale(value)) {
    return value;
  }

  const normalizedValue = value.toLowerCase();

  if (
    normalizedValue.startsWith("zh-tw") ||
    normalizedValue.startsWith("zh-hant")
  ) {
    return "zh-TW";
  }

  if (
    normalizedValue.startsWith("zh-cn") ||
    normalizedValue.startsWith("zh-hans") ||
    normalizedValue === "zh"
  ) {
    return "zh-CN";
  }

  if (normalizedValue.startsWith("en")) {
    return "en";
  }

  return null;
};
