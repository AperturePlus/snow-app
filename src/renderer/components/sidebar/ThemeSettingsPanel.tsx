import { RotateCcw, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AutoDismissNotice } from "../AutoDismissNotice";
import { CustomSelect } from "../common/CustomSelect";
import { useI18n } from "../../i18n";
import { getPresetById } from "./themeSettings/themePresets";
import {
  applyPaletteToDocument,
  applyThemeModeToDocument,
  DEFAULT_THEME_SETTINGS,
  normalizeThemeSettings,
  resolveActivePalette,
} from "./themeSettings/themeSettingsUtils";
import type {
  ThemeBackground,
  ThemeMode,
  ThemePalette,
  ThemeSettings,
  ThemeSettingsPanelProps,
} from "./themeSettings/types";
import { themeBgUrl } from "../../utils/themeBgUrl";
import { ThemeBackgroundSection } from "./themeSettings/ThemeBackgroundSection";
import { ThemeColorEditor } from "./themeSettings/ThemeColorEditor";
import { ThemeModeSelector } from "./themeSettings/ThemeModeSelector";
import { ThemePresetGrid } from "./themeSettings/ThemePresetGrid";
import { ThemePreview } from "./themeSettings/ThemePreview";

type EditorTab = "light" | "dark";

const SAVE_DEBOUNCE_MS = 600;

export function ThemeSettingsPanel({
  onClose,
}: ThemeSettingsPanelProps): React.JSX.Element {
  const { t } = useI18n();
  const [form, setForm] = useState<ThemeSettings>(DEFAULT_THEME_SETTINGS);
  const [lastSaved, setLastSaved] = useState<ThemeSettings>(
    DEFAULT_THEME_SETTINGS
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [editorTab, setEditorTab] = useState<EditorTab>("light");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const isMountedRef = useRef(true);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, []);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const raw = await window.snow.getThemeSettings();
      const normalized = normalizeThemeSettings(raw);
      setForm(normalized);
      setLastSaved(normalized);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : t("settings.themeLoadError", {
              defaultValue: "Failed to load theme settings",
            })
      );
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  // 实时预览：表单变化时即时应用到 document，但不持久化。
  useEffect(() => {
    if (isLoading) {
      return;
    }
    const systemDark =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    // 根据 mode 计算当前生效的亮/暗，而非直接用 systemDark。
    // 否则用户选"浅色"但系统是深色时仍会取深色调色板。
    const effectiveDark =
      form.mode === "system" ? systemDark : form.mode === "dark";
    applyThemeModeToDocument(form.mode);
    const palette = resolveActivePalette(form, effectiveDark);
    applyPaletteToDocument(palette);

    // 同步窗口背景色到主进程，使 Electron 窗口背景跟随预览。
    const bgPrimary = palette.bgPrimary;
    if (bgPrimary && typeof window !== "undefined" && window.snow) {
      void window.snow.setThemeBackgroundColor(bgPrimary).catch(() => {
        // 忽略同步失败。
      });
    }

    const bg = form.background;
    const root = document.documentElement;
    if (bg.enabled && bg.imagePath) {
      const opacity = Math.max(0, Math.min(1, bg.opacity));
      const blur = Math.max(0, bg.blur);
      root.style.setProperty(
        "--theme-bg-image",
        `url("${themeBgUrl(bg.imagePath)}")`
      );
      root.style.setProperty("--theme-bg-opacity", String(opacity));
      root.style.setProperty("--theme-bg-blur", `${blur}px`);
      root.setAttribute("data-theme-bg", "on");
    } else {
      root.style.removeProperty("--theme-bg-image");
      root.style.removeProperty("--theme-bg-opacity");
      root.style.removeProperty("--theme-bg-blur");
      root.removeAttribute("data-theme-bg");
    }
  }, [form, isLoading]);

  const previewPalette = useMemo<ThemePalette>(() => {
    const systemDark =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    const effectiveDark =
      form.mode === "system" ? systemDark : form.mode === "dark";
    return resolveActivePalette(form, effectiveDark);
  }, [form]);

  const handleModeChange = (mode: ThemeMode): void => {
    setForm((previous: ThemeSettings) => ({ ...previous, mode }));
  };

  const handlePresetSelect = (presetId: string): void => {
    setForm((previous: ThemeSettings) => {
      if (presetId === "custom") {
        return { ...previous, presetId };
      }
      const preset = getPresetById(presetId);
      if (!preset) {
        return previous;
      }
      // 切换到预设时，将预设的调色板复制到 custom，作为后续自定义的起点。
      return {
        ...previous,
        presetId,
        custom: {
          light: { ...preset.light },
          dark: { ...preset.dark },
        },
      };
    });
  };

  const handleEnableCustom = (enabled: boolean): void => {
    if (enabled) {
      setForm((previous: ThemeSettings) => {
        const preset = getPresetById(previous.presetId);
        const baseLight = preset?.light ?? previous.custom.light;
        const baseDark = preset?.dark ?? previous.custom.dark;
        return {
          ...previous,
          presetId: "custom",
          custom: {
            light: { ...baseLight },
            dark: { ...baseDark },
          },
        };
      });
    } else {
      // 关闭自定义时回退到 snow 预设。
      const fallback = getPresetById("snow");
      if (fallback) {
        setForm((previous: ThemeSettings) => ({
          ...previous,
          presetId: "snow",
          custom: {
            light: { ...fallback.light },
            dark: { ...fallback.dark },
          },
        }));
      }
    }
  };

  const handleColorChange = (role: keyof ThemePalette, value: string): void => {
    setForm((previous: ThemeSettings) => ({
      ...previous,
      custom: {
        ...previous.custom,
        [editorTab]: {
          ...previous.custom[editorTab],
          [role]: value,
        },
      },
    }));
  };

  const handleBackgroundChange = (background: ThemeBackground): void => {
    setForm((previous: ThemeSettings) => ({ ...previous, background }));
  };

  const handleSelectImage = async (): Promise<void> => {
    setIsBusy(true);
    setError("");
    setStatus("");
    try {
      const title = t("settings.themeBackgroundSelectDialogTitle", {
        defaultValue: "Select background image",
      });
      const sourcePath = await window.snow.selectThemeBackgroundImage(title);
      if (!sourcePath) {
        return;
      }
      const savedPath = await window.snow.saveThemeBackgroundImage(sourcePath);
      setForm((previous: ThemeSettings) => ({
        ...previous,
        background: {
          ...previous.background,
          imagePath: savedPath,
          enabled: true,
        },
      }));
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : t("settings.themeBackgroundSaveError", {
              defaultValue: "Failed to save background image",
            })
      );
    } finally {
      setIsBusy(false);
    }
  };

  const saveSettings = useCallback(
    async (settings: ThemeSettings) => {
      setIsSaving(true);
      setError("");
      try {
        await window.snow.setThemeSettings(settings);
        if (isMountedRef.current) {
          setLastSaved(settings);
          // 通知全局 useTheme Hook 重新加载，使 App 级状态与持久化数据同步。
          window.dispatchEvent(new CustomEvent("theme:changed"));
          setStatus(
            t("settings.themeSaveSuccess", {
              defaultValue: "Theme settings saved.",
            })
          );
        }
      } catch (e) {
        if (isMountedRef.current) {
          setError(
            e instanceof Error
              ? e.message
              : t("settings.themeSaveError", {
                  defaultValue: "Failed to save theme settings",
                })
          );
        }
      } finally {
        if (isMountedRef.current) {
          setIsSaving(false);
        }
      }
    },
    [t]
  );

  // 修改即保存：表单变化后 debounce 保存。
  useEffect(() => {
    if (isLoading) {
      return;
    }
    if (JSON.stringify(form) === JSON.stringify(lastSaved)) {
      return;
    }

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void saveSettings(form);
    }, SAVE_DEBOUNCE_MS);
  }, [form, isLoading, lastSaved, saveSettings]);

  const handleReset = (): void => {
    setForm(lastSaved);
    setError("");
    setStatus("");
  };
  const handleTabChange = (tab: EditorTab): void => {
    setEditorTab(tab);
  };

  const busy = isLoading || isSaving || isBusy;
  const isCustom = form.presetId === "custom";
  const currentPalette = isCustom
    ? editorTab === "light"
      ? form.custom.light
      : form.custom.dark
    : previewPalette;

  return (
    <div className="api-settings-page" role="region">
      <div className="api-settings-page-header">
        <div className="api-settings-title-group">
          <strong>
            {t("settings.themeTitle", {
              defaultValue: "Theme settings",
            })}
          </strong>
        </div>
        {onClose && (
          <button
            className="icon-btn ghost"
            onClick={onClose}
            type="button"
            aria-label={t("settings.closeThemeSettings", {
              defaultValue: "Close theme settings",
            })}
            title={t("settings.closeThemeSettings", {
              defaultValue: "Close theme settings",
            })}
          >
            <X size={15} strokeWidth={1.8} />
          </button>
        )}
      </div>

      <AutoDismissNotice
        message={error || status}
        tone={error ? "error" : "success"}
        onDismiss={() => {
          setError("");
          setStatus("");
        }}
      />

      <div className="api-settings-manual-form">
        <div className="api-settings-form-body">
          <div className="api-settings-form-section">
            <div className="api-settings-form-section-header">
              <strong className="api-settings-form-section-title">
                {t("settings.themeMode", {
                  defaultValue: "Appearance mode",
                })}
              </strong>
            </div>
            <span className="settings-item-description">
              {t("settings.themeModeInfo", {
                defaultValue:
                  "Choose whether the app follows the system, stays light, or stays dark.",
              })}
            </span>
            <ThemeModeSelector
              mode={form.mode}
              disabled={busy}
              onChange={handleModeChange}
            />
          </div>

          <div className="api-settings-form-section">
            <div className="api-settings-form-section-header">
              <strong className="api-settings-form-section-title">
                {t("settings.themePresets", {
                  defaultValue: "Preset themes",
                })}
              </strong>
            </div>
            <span className="settings-item-description">
              {t("settings.themePresetsInfo", {
                defaultValue:
                  "Pick a built-in color scheme. Light and dark variants are bundled together.",
              })}
            </span>
            <ThemePresetGrid
              selectedPresetId={form.presetId}
              disabled={busy}
              onSelect={handlePresetSelect}
            />
          </div>

          <div className="api-settings-form-section">
            <div className="api-settings-form-section-header">
              <strong className="api-settings-form-section-title">
                {t("settings.themeCustomTitle", {
                  defaultValue: "Custom theme",
                })}
              </strong>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={isCustom}
                  onChange={(event) =>
                    handleEnableCustom(event.target.checked)
                  }
                  disabled={busy}
                  hidden
                />
                <span className="toggle-slider" />
                <span>
                  {isCustom
                    ? t("settings.enabled", {
                        defaultValue: "Enabled",
                      })
                    : t("settings.disabled", {
                        defaultValue: "Disabled",
                      })}
                </span>
              </label>
            </div>
            <span className="settings-item-description">
              {t("settings.themeCustomInfo", {
                defaultValue:
                  "Enable to fine-tune every color. Light and dark palettes are edited separately.",
              })}
            </span>
            {isCustom && (
              <div className="theme-custom-editor">
                <div className="theme-custom-editor-tabs">
                  <CustomSelect
                    value={editorTab}
                    onChange={(value) =>
                      handleTabChange(value as EditorTab)
                    }
                    disabled={busy}
                    options={[
                      {
                        value: "light",
                        label: t("settings.themeTabLight", {
                          defaultValue: "Light palette",
                        }),
                      },
                      {
                        value: "dark",
                        label: t("settings.themeTabDark", {
                          defaultValue: "Dark palette",
                        }),
                      },
                    ]}
                  />
                </div>
                <ThemeColorEditor
                  palette={currentPalette}
                  disabled={busy}
                  onChange={handleColorChange}
                />
              </div>
            )}
          </div>

          <ThemeBackgroundSection
            background={form.background}
            disabled={busy}
            busy={isBusy}
            onChange={handleBackgroundChange}
            onSelectImage={handleSelectImage}
          />

          <div className="api-settings-form-section">
            <div className="api-settings-form-section-header">
              <strong className="api-settings-form-section-title">
                {t("settings.themePreviewTitle", {
                  defaultValue: "Preview",
                })}
              </strong>
            </div>
            <ThemePreview palette={previewPalette} />
          </div>
        </div>

        <div className="api-settings-form-actions">
          <button
            className="api-settings-form-btn secondary"
            onClick={handleReset}
            type="button"
            disabled={busy}
          >
            <RotateCcw size={15} strokeWidth={1.9} />
            <span>{t("settings.reset", { defaultValue: "Reset" })}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
