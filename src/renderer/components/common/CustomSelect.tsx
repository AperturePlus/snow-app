import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export type CustomSelectOption = {
  value: string;
  label: string;
};

type CustomSelectProps = {
  value: string;
  options: CustomSelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
};

export function CustomSelect({
  value,
  options,
  onChange,
  disabled = false,
}: CustomSelectProps): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const selectedOption = options.find((opt) => opt.value === value);
  const displayLabel = selectedOption?.label ?? value;

  const handleSelect = useCallback(
    (val: string) => {
      setIsOpen(false);
      onChange(val);
    },
    [onChange]
  );

  return (
    <div className="custom-select" ref={containerRef}>
      <button
        type="button"
        className="custom-select-trigger"
        onClick={() => !disabled && setIsOpen((v) => !v)}
        disabled={disabled}
      >
        <span className="custom-select-label" title={displayLabel}>
          {displayLabel}
        </span>
        <ChevronDown size={14} />
      </button>
      {isOpen && (
        <div className="custom-select-dropdown">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className="custom-select-item"
              onClick={() => handleSelect(opt.value)}
            >
              <span>{opt.label}</span>
              {opt.value === value && (
                <Check size={14} className="custom-select-check" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
