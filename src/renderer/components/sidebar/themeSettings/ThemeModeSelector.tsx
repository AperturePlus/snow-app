import { useI18n } from "../../../i18n";
import type { ThemeMode } from "./types";
import { ThemeModeThumbnail } from "./ThemeModeThumbnail";

type ThemeModeSelectorProps = {
  mode: ThemeMode;
  disabled?: boolean;
  onChange: (mode: ThemeMode) => void;
};

const MODE_OPTIONS: {
  value: ThemeMode;
  labelKey: string;
  defaultLabel: string;
}[] = [
  {
    value: "system",
    labelKey: "settings.themeModeSystem",
    defaultLabel: "System",
  },
  {
    value: "light",
    labelKey: "settings.themeModeLight",
    defaultLabel: "Light",
  },
  {
    value: "dark",
    labelKey: "settings.themeModeDark",
    defaultLabel: "Dark",
  },
];

export function ThemeModeSelector({
  mode,
  disabled,
  onChange,
}: ThemeModeSelectorProps): React.JSX.Element {
  const { t } = useI18n();

  return (
    <div className="theme-mode-selector" role="radiogroup">
      {MODE_OPTIONS.map((option) => {
        const isActive = mode === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            className={`theme-mode-option ${isActive ? "active" : ""}`}
            onClick={() => onChange(option.value)}
            disabled={disabled}
          >
            <ThemeModeThumbnail mode={option.value} />
            <span>
              {t(option.labelKey, { defaultValue: option.defaultLabel })}
            </span>
          </button>
        );
      })}
    </div>
  );
}
