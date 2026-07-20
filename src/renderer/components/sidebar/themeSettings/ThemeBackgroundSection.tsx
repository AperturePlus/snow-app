import { ImageIcon, Trash2 } from "lucide-react";
import { useI18n } from "../../../i18n";
import type { ThemeBackground } from "./types";
import { themeBgUrl } from "../../../utils/themeBgUrl";

type ThemeBackgroundSectionProps = {
  background: ThemeBackground;
  disabled?: boolean;
  busy?: boolean;
  onChange: (background: ThemeBackground) => void;
  onSelectImage: () => Promise<void>;
};

export function ThemeBackgroundSection({
  background,
  disabled,
  busy,
  onChange,
  onSelectImage,
}: ThemeBackgroundSectionProps): React.JSX.Element {
  const { t } = useI18n();
  const isBusy = disabled || busy;

  const updateField = <K extends keyof ThemeBackground>(
    field: K,
    value: ThemeBackground[K]
  ): void => {
    onChange({ ...background, [field]: value });
  };

  return (
    <div className="api-settings-form-section">
      <div className="api-settings-form-section-header">
        <strong className="api-settings-form-section-title">
          {t("settings.themeBackgroundTitle", {
            defaultValue: "Background image",
          })}
        </strong>
        <label className="toggle-switch">
          <input
            type="checkbox"
            checked={background.enabled}
            onChange={(event) => updateField("enabled", event.target.checked)}
            disabled={isBusy || !background.imagePath}
            hidden
          />
          <span className="toggle-slider" />
          <span>
            {background.enabled
              ? t("settings.enabled", { defaultValue: "Enabled" })
              : t("settings.disabled", { defaultValue: "Disabled" })}
          </span>
        </label>
      </div>
      <span className="settings-item-description">
        {t("settings.themeBackgroundInfo", {
          defaultValue:
            "Upload a custom background image and adjust its opacity and blur.",
        })}
      </span>
      <div className="api-settings-form-grid">
        <div className="theme-background-preview">
          {background.imagePath ? (
            <img
              src={themeBgUrl(background.imagePath)}
              alt=""
              className="theme-background-thumbnail"
            />
          ) : (
            <span className="theme-background-placeholder">
              <ImageIcon size={24} strokeWidth={1.6} />
            </span>
          )}
        </div>
        <div className="theme-background-actions">
          <button
            type="button"
            className="api-settings-form-btn secondary"
            onClick={() => void onSelectImage()}
            disabled={isBusy}
          >
            <ImageIcon size={15} strokeWidth={1.8} />
            <span>
              {t("settings.themeBackgroundSelect", {
                defaultValue: "Select image",
              })}
            </span>
          </button>
          {background.imagePath && (
            <button
              type="button"
              className="api-settings-form-btn secondary danger"
              onClick={() =>
                onChange({
                  enabled: false,
                  imagePath: "",
                  opacity: 1,
                  blur: 0,
                })
              }
              disabled={isBusy}
            >
              <Trash2 size={15} strokeWidth={1.8} />
              <span>
                {t("settings.themeBackgroundRemove", {
                  defaultValue: "Remove",
                })}
              </span>
            </button>
          )}
        </div>
      </div>
      {background.imagePath && (
        <>
          <label className="theme-slider-field">
            <span className="theme-slider-label">
              {t("settings.themeBackgroundOpacity", {
                defaultValue: "Opacity",
              })}
              <span className="theme-slider-value">
                {Math.round(background.opacity * 100)}%
              </span>
            </span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={background.opacity}
              onChange={(event) =>
                updateField("opacity", Number.parseFloat(event.target.value))
              }
              disabled={isBusy}
            />
          </label>
          <label className="theme-slider-field">
            <span className="theme-slider-label">
              {t("settings.themeBackgroundBlur", {
                defaultValue: "Blur",
              })}
              <span className="theme-slider-value">
                {Math.round(background.blur)}px
              </span>
            </span>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={background.blur}
              onChange={(event) =>
                updateField("blur", Number.parseFloat(event.target.value))
              }
              disabled={isBusy}
            />
          </label>
        </>
      )}
    </div>
  );
}
