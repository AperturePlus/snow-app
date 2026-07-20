import { useI18n } from "../../../i18n";
import type { ThemePalette } from "./types";

type ThemePreviewProps = {
  palette: ThemePalette;
};

export function ThemePreview({ palette }: ThemePreviewProps): React.JSX.Element {
  const { t } = useI18n();
  const previewStyle = {
    background: palette.bgPrimary,
    borderColor: palette.borderColor,
    color: palette.textPrimary,
  } as React.CSSProperties;

  return (
    <div className="theme-preview" style={previewStyle}>
      <span className="theme-preview-title">
        {t("settings.themePreviewTitle", { defaultValue: "Preview" })}
      </span>
      <div className="theme-preview-body">
        <div
          className="theme-preview-sidebar"
          style={{
            background: palette.bgSecondary,
            borderColor: palette.borderLight,
          }}
        >
          <span
            className="theme-preview-item"
            style={{
              background: palette.bgActive,
              color: palette.textPrimary,
            }}
          >
            {t("settings.themePreviewSidebarItem", {
              defaultValue: "Selected item",
            })}
          </span>
          <span
            className="theme-preview-item"
            style={{ color: palette.textSecondary }}
          >
            {t("settings.themePreviewSidebarNormal", {
              defaultValue: "Normal item",
            })}
          </span>
          <span
            className="theme-preview-item"
            style={{ color: palette.textMuted }}
          >
            {t("settings.themePreviewSidebarMuted", {
              defaultValue: "Muted item",
            })}
          </span>
        </div>
        <div className="theme-preview-main">
          <div
            className="theme-preview-bubble"
            style={{
              background: palette.bgTertiary,
              color: palette.textPrimary,
              borderColor: palette.borderLight,
            }}
          >
            {t("settings.themePreviewBubble", {
              defaultValue: "Assistant message bubble",
            })}
          </div>
          <div className="theme-preview-buttons">
            <span
              className="theme-preview-btn primary"
              style={{
                background: palette.accentBlue,
                color: palette.onSolid,
              }}
            >
              {t("settings.themePreviewBtnPrimary", {
                defaultValue: "Primary",
              })}
            </span>
            <span
              className="theme-preview-btn secondary"
              style={{
                background: palette.bgHover,
                color: palette.textSecondary,
                borderColor: palette.borderColor,
              }}
            >
              {t("settings.themePreviewBtnSecondary", {
                defaultValue: "Secondary",
              })}
            </span>
            <span
              className="theme-preview-btn success"
              style={{
                background: palette.accentGreenBg,
                color: palette.accentGreenText,
              }}
            >
              {t("settings.themePreviewBtnSuccess", {
                defaultValue: "Success",
              })}
            </span>
            <span
              className="theme-preview-btn danger"
              style={{
                background: palette.accentRedBg,
                color: palette.accentRedText,
              }}
            >
              {t("settings.themePreviewBtnDanger", {
                defaultValue: "Danger",
              })}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
