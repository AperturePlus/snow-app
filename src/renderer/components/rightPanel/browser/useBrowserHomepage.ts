import { useCallback, useEffect, useState } from "react";
import {
  BROWSER_HOMEPAGE_SETTING_CODE,
  BROWSER_HOMEPAGE_SETTING_NAME,
  DEFAULT_BROWSER_HOMEPAGE,
  normalizeBrowserHomepage,
  readBrowserHomepageJson,
} from "./browserHomepageConstants";

const BROWSER_HOMEPAGE_CHANGED_EVENT = "browser-homepage-changed";

/**
 * Loads the browser homepage from the system settings store and keeps
 * it in sync when settings are changed elsewhere.
 */
export function useBrowserHomepage(): {
  homepage: string;
  setHomepage: (url: string) => Promise<void>;
} {
  const [homepage, setHomepageState] = useState<string>(
    DEFAULT_BROWSER_HOMEPAGE
  );

  useEffect(() => {
    let disposed = false;

    const loadSettings = async () => {
      try {
        const value = await window.snow.getSystemSettingValue(
          BROWSER_HOMEPAGE_SETTING_CODE
        );
        if (!disposed) {
          setHomepageState(readBrowserHomepageJson(value));
        }
      } catch {
        if (!disposed) {
          setHomepageState(DEFAULT_BROWSER_HOMEPAGE);
        }
      }
    };

    void loadSettings();

    const handleChange = () => void loadSettings();
    window.addEventListener(
      BROWSER_HOMEPAGE_CHANGED_EVENT,
      handleChange as EventListener
    );

    return () => {
      disposed = true;
      window.removeEventListener(
        BROWSER_HOMEPAGE_CHANGED_EVENT,
        handleChange as EventListener
      );
    };
  }, []);

  const setHomepage = useCallback(async (url: string) => {
    const normalized = normalizeBrowserHomepage(url);
    await window.snow.setSystemSetting(
      BROWSER_HOMEPAGE_SETTING_NAME,
      BROWSER_HOMEPAGE_SETTING_CODE,
      JSON.stringify(normalized)
    );
    setHomepageState(normalized);
    window.dispatchEvent(new Event(BROWSER_HOMEPAGE_CHANGED_EVENT));
  }, []);

  return { homepage, setHomepage };
}

/**
 * Notify all browser instances that homepage has changed.
 */
export function notifyBrowserHomepageChanged(): void {
  window.dispatchEvent(new Event(BROWSER_HOMEPAGE_CHANGED_EVENT));
}
