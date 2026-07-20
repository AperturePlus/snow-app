import { Monitor, Moon, Sun } from "lucide-react";
import { useI18n } from "../../../i18n";
import type { ThemeMode } from "./types";

type ThemeModeSelectorProps = {
  mode: ThemeMode;
  disabled?: boolean;
  onChange: (mode: ThemeMode) => void;
};

const MODE_OPTIONS: {
  value: ThemeMode;
  icon: typeof Monitor;
  labelKey: string;
  defaultLabel: string;
}[] = [
  {
    value: "system",
    icon: Monitor,
    labelKey: "settings.themeModeSystem",
    defaultLabel: "System",
  },
  {
    value: "light",
    icon: Sun,
    labelKey: "settings.themeModeLight",
    defaultLabel: "Light",
  },
  {
    value: "dark",
    icon: Moon,
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
        const Icon = option.icon;
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
            <Icon size={16} strokeWidth={1.8} />
            <span>
              {t(option.labelKey, { defaultValue: option.defaultLabel })}
            </span>
          </button>
        );
      })}
    </div>
  );
}
