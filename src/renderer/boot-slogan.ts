/**
 * Boot-screen slogan — lightweight, CSP-compliant.
 *
 * Runs before the main React bundle to set the Han Feizi tagline
 * in the user's locale. Locale detection mirrors I18nProvider:
 *   1. localStorage("snow.locale")
 *   2. navigator.language
 *   3. fallback "en"
 *
 * This module intentionally avoids importing the full i18n resources
 * to keep the boot chunk minimal.
 */

type BootLocale = "en" | "zh-CN" | "zh-TW";

const SLOGANS: Record<BootLocale, string> = {
  en: "Times alter, circumstances shift",
  "zh-CN": "\u4E16\u5F02\u5219\u4E8B\u5F02\uFF0C\u4E8B\u5F02\u5219\u5907\u53D8",
  "zh-TW": "\u4E16\u7570\u5247\u4E8B\u7570\uFF0C\u4E8B\u7570\u5247\u5099\u8B8A",
};

const STORAGE_KEY = "snow.locale";

const normalizeLocale = (
  value: string | null | undefined,
): BootLocale | null => {
  if (!value) {
    return null;
  }

  if (value in SLOGANS) {
    return value as BootLocale;
  }

  const v = value.toLowerCase();

  if (v.startsWith("zh-tw") || v.startsWith("zh-hant")) {
    return "zh-TW";
  }

  if (v.startsWith("zh-cn") || v.startsWith("zh-hans") || v === "zh") {
    return "zh-CN";
  }

  if (v.startsWith("en")) {
    return "en";
  }

  return null;
};

const detectLocale = (): BootLocale => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const normalized = normalizeLocale(stored);

    if (normalized) {
      return normalized;
    }
  } catch {
    // localStorage may be unavailable (private mode, etc.) — fall through.
  }

  return normalizeLocale(navigator.language) ?? "en";
};

const el = document.querySelector<HTMLElement>(".boot-slogan");

if (el) {
  el.textContent = SLOGANS[detectLocale()] ?? SLOGANS.en;
}
