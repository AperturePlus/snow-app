import { Plus } from "lucide-react";
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
};

export const PlusMenu = ({ sections }: PlusMenuProps): React.JSX.Element => {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownDir = useDropdownDirection(containerRef, isOpen);

  const handleClose = useCallback(() => {
    setIsOpen(false);
  }, []);

  const handleToggle = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

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
        </div>
      )}
    </div>
  );
};
