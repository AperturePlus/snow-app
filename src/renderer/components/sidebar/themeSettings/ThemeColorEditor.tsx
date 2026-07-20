import { useI18n } from "../../../i18n";
import { COLOR_GROUPS, isValidHex } from "./themeSettingsUtils";
import type { ThemePalette } from "./types";

type ThemeColorEditorProps = {
  palette: ThemePalette;
  disabled?: boolean;
  onChange: (role: keyof ThemePalette, value: string) => void;
};

export function ThemeColorEditor({
  palette,
  disabled,
  onChange,
}: ThemeColorEditorProps): React.JSX.Element {
  const { t } = useI18n();

  return (
    <div className="theme-color-editor">
      {COLOR_GROUPS.map((group) => (
        <div key={group.titleKey} className="theme-color-group">
          <strong className="theme-color-group-title">
            {t(group.titleKey, { defaultValue: group.defaultTitle })}
          </strong>
          <div className="theme-color-grid">
            {group.roles.map((roleDef) => {
              const value = palette[roleDef.role];
              const valid = isValidHex(value) || value.startsWith("rgba");
              return (
                <label
                  key={roleDef.role}
                  className="theme-color-field"
                >
                  <span className="theme-color-label">
                    {t(roleDef.labelKey, {
                      defaultValue: roleDef.defaultLabel,
                    })}
                  </span>
                  <span className="theme-color-inputs">
                    <span
                      className={`theme-color-swatch ${
                        valid ? "" : "invalid"
                      }`}
                      style={{
                        background: value || "transparent",
                        borderColor: valid
                          ? "var(--border-color)"
                          : "var(--accent-red)",
                      }}
                    >
                      <input
                        type="color"
                        value={value.startsWith("#") ? value : "#ffffff"}
                        onChange={(event) =>
                          onChange(roleDef.role, event.target.value)
                        }
                        disabled={disabled}
                        aria-label={t(roleDef.labelKey, {
                          defaultValue: roleDef.defaultLabel,
                        })}
                      />
                    </span>
                    <input
                      type="text"
                      className="theme-color-text"
                      value={value}
                      onChange={(event) =>
                        onChange(roleDef.role, event.target.value)
                      }
                      disabled={disabled}
                      placeholder="#rrggbb"
                    />
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
