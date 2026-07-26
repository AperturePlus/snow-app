import { Type } from "lucide-react";
import { useI18n } from "../../../i18n";

type ThemeFontSectionProps = {
  fontFamily: string;
  disabled?: boolean;
  onChange: (fontFamily: string) => void;
};

/**
 * 常见系统字体快捷选项，跨平台可用。
 * 用户也可以直接在输入框中手动输入任意 CSS font-family 字符串。
 */
const COMMON_FONTS: { label: string; value: string }[] = [
  { label: "System default", value: "" },
  { label: "Arial", value: "Arial, sans-serif" },
  { label: "Helvetica", value: "Helvetica, Arial, sans-serif" },
  { label: "Times New Roman", value: "'Times New Roman', Times, serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Courier New", value: "'Courier New', Courier, monospace" },
  { label: "Verdana", value: "Verdana, Geneva, sans-serif" },
  { label: "Tahoma", value: "Tahoma, Geneva, sans-serif" },
  { label: "Trebuchet MS", value: "'Trebuchet MS', Helvetica, sans-serif" },
  { label: "Inter", value: "Inter, sans-serif" },
  { label: "Segoe UI", value: "'Segoe UI', sans-serif" },
  { label: "Roboto", value: "Roboto, sans-serif" },
  { label: "Microsoft YaHei", value: "'Microsoft YaHei', sans-serif" },
  { label: "PingFang SC", value: "'PingFang SC', sans-serif" },
  { label: "Noto Sans SC", value: "'Noto Sans SC', sans-serif" },
  { label: "Source Han Sans", value: "'Source Han Sans SC', sans-serif" },
];

export function ThemeFontSection({
  fontFamily,
  disabled,
  onChange,
}: ThemeFontSectionProps): React.JSX.Element {
  const { t } = useI18n();

  const handleQuickSelect = (value: string): void => {
    onChange(value);
  };

  return (
    <div className="api-settings-form-section">
      <div className="api-settings-form-section-header">
        <strong className="api-settings-form-section-title">
          {t("settings.themeFontTitle", {
            defaultValue: "Font",
          })}
        </strong>
      </div>
      <span className="settings-item-description">
        {t("settings.themeFontInfo", {
          defaultValue:
            "Set the application font. Choose a common font or enter a custom CSS font-family value.",
        })}
      </span>

      <div className="theme-font-input-row">
        <Type size={15} strokeWidth={1.8} className="theme-font-input-icon" />
        <input
          type="text"
          className="theme-font-input"
          value={fontFamily}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          placeholder={t("settings.themeFontPlaceholder", {
            defaultValue: "e.g. Inter, sans-serif",
          })}
        />
      </div>

      <div className="theme-font-quick-grid">
        {COMMON_FONTS.map((font) => (
          <button
            key={font.label}
            type="button"
            className={
              "theme-font-quick-btn" +
              (fontFamily === font.value ? " selected" : "")
            }
            onClick={() => handleQuickSelect(font.value)}
            disabled={disabled}
            title={font.value || t("settings.themeFontSystemDefault", { defaultValue: "System default" })}
            style={font.value ? { fontFamily: font.value } : undefined}
          >
            {font.label}
          </button>
        ))}
      </div>
    </div>
  );
}
