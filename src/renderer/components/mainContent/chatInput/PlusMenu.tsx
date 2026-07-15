import { ArrowDownToLine, Plus, ShieldAlert } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../../../i18n";
import { useDropdownDirection } from "./useDropdownDirection";

export type PlusMenuItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  description?: string;
  onSelect: () => void;
};

export type PlusMenuSection = {
  id: string;
  label: string;
  items: PlusMenuItem[];
};

export type PlusMenuProps = {
  sections: PlusMenuSection[];
  yoloMode: boolean;
  isUpdatingYoloMode: boolean;
  onYoloModeChange?: (enabled: boolean) => void;
  onRefreshYoloMode?: () => void | Promise<boolean | void>;
  autoScrollEnabled: boolean;
  onAutoScrollChange?: (enabled: boolean) => void;
};

export const PlusMenu = ({
  sections,
  yoloMode,
  isUpdatingYoloMode,
  onYoloModeChange,
  onRefreshYoloMode,
  autoScrollEnabled,
  onAutoScrollChange,
}: PlusMenuProps): React.JSX.Element => {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownDir = useDropdownDirection(containerRef, isOpen);

  const handleClose = useCallback(() => {
    setIsOpen(false);
  }, []);

  const handleToggle = useCallback(() => {
    setIsOpen((prev) => {
      const next = !prev;
      if (next) {
        // Re-read the persisted app setting whenever the menu opens.
        void onRefreshYoloMode?.();
      }
      return next;
    });
  }, [onRefreshYoloMode]);

  const handleItemClick = useCallback(
    (item: PlusMenuItem) => {
      item.onSelect();
      handleClose();
    },
    [handleClose]
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleDocumentPointerDown = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        handleClose();
      }
    };
    document.addEventListener("mousedown", handleDocumentPointerDown);
    return () => {
      document.removeEventListener("mousedown", handleDocumentPointerDown);
    };
  }, [isOpen, handleClose]);

  return (
    <div className="plus-menu" ref={containerRef}>
      <button
        className="toolbar-btn plus-trigger"
        aria-label={t("plusMenu.label")}
        aria-expanded={isOpen}
        onClick={handleToggle}
        type="button"
      >
        <Plus size={16} />
      </button>
      {isOpen && (
        <div className={`plus-menu-dropdown drop-${dropdownDir}`}>
          {sections.map((section, sectionIndex) => (
            <div key={section.id} className="plus-menu-section">
              <div className="plus-menu-section-title">{section.label}</div>
              {section.items.map((item) => {
                const ItemIcon = item.icon;
                return (
                  <button
                    key={item.id}
                    className="plus-menu-item"
                    onClick={() => handleItemClick(item)}
                    type="button"
                  >
                    <ItemIcon size={14} className="plus-menu-item-icon" />
                    <div className="plus-menu-item-content">
                      <span className="plus-menu-item-label">{item.label}</span>
                      {item.description && (
                        <span className="plus-menu-item-description">
                          {item.description}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
              {sectionIndex < sections.length - 1 && (
                <div className="plus-menu-section-divider" />
              )}
            </div>
          ))}
          <div className="plus-menu-section">
            <div className="plus-menu-section-divider" />
            <div className="plus-menu-section-title">
              {t("plusMenu.sectionMode")}
            </div>
            <div className="plus-menu-item plus-menu-yolo-item">
              <ArrowDownToLine size={14} className="plus-menu-item-icon" />
              <div className="plus-menu-item-content">
                <span className="plus-menu-item-label">
                  {t("plusMenu.autoScroll")}
                </span>
                <span className="plus-menu-item-description">
                  {t("plusMenu.autoScrollDescription")}
                </span>
              </div>
              <label className="toggle-switch plus-menu-yolo-switch">
                <input
                  aria-label={t("plusMenu.autoScroll")}
                  checked={autoScrollEnabled}
                  disabled={!onAutoScrollChange}
                  onChange={() => {
                    onAutoScrollChange?.(!autoScrollEnabled);
                  }}
                  type="checkbox"
                />
                <span className="toggle-slider" />
              </label>
            </div>
            <div className="plus-menu-item plus-menu-yolo-item">
              <ShieldAlert size={14} className="plus-menu-item-icon" />
              <div className="plus-menu-item-content">
                <span className="plus-menu-item-label">
                  {t("plusMenu.yoloMode")}
                </span>
                <span className="plus-menu-item-description">
                  {t("plusMenu.yoloModeDescription")}
                </span>
              </div>
              <label className="toggle-switch plus-menu-yolo-switch">
                <input
                  aria-label={t("plusMenu.yoloMode")}
                  checked={yoloMode}
                  disabled={isUpdatingYoloMode || !onYoloModeChange}
                  onChange={() => {
                    void onYoloModeChange?.(!yoloMode);
                  }}
                  type="checkbox"
                />
                <span className="toggle-slider" />
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
