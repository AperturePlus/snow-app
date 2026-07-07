export const BROWSER_HOMEPAGE_SETTING_NAME = "Browser homepage";
export const BROWSER_HOMEPAGE_SETTING_CODE = "browser_homepage";

export const DEFAULT_BROWSER_HOMEPAGE = "https://www.google.com";

/**
 * Normalize raw storage value into a valid homepage URL string.
 * Empty string is allowed (means "blank page").
 */
export const normalizeBrowserHomepage = (value: unknown): string => {
  if (typeof value !== "string") {
    return DEFAULT_BROWSER_HOMEPAGE;
  }
  const trimmed = value.trim();
  // Allow empty — means no homepage (blank page)
  if (!trimmed) {
    return "";
  }
  return trimmed;
};

export const readBrowserHomepageJson = (value: string | null): string => {
  if (!value) {
    return DEFAULT_BROWSER_HOMEPAGE;
  }
  try {
    return normalizeBrowserHomepage(JSON.parse(value));
  } catch {
    return DEFAULT_BROWSER_HOMEPAGE;
  }
};
