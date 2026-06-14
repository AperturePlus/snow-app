import { Pencil, Trash2 } from "lucide-react";
import { useI18n } from "../../../i18n";
import { getHeaderCount, getHeaderPreview } from "./customHeadersUtils";
import type { CustomHeaderScheme } from "./types";

type CustomHeadersSchemeListProps = {
  schemes: CustomHeaderScheme[];
  isBusy: boolean;
  onToggleActive: (scheme: CustomHeaderScheme) => void;
  onEdit: (scheme: CustomHeaderScheme) => void;
  onDelete: (scheme: CustomHeaderScheme) => void;
};

export function CustomHeadersSchemeList({
  schemes,
  isBusy,
  onToggleActive,
  onEdit,
  onDelete,
}: CustomHeadersSchemeListProps): React.JSX.Element {
  const { t } = useI18n();

  return (
    <div className="api-settings-form-section">
      <div className="api-settings-form-section-header">
        <strong className="api-settings-form-section-title">
          {t("settings.customHeadersListTitle", {
            defaultValue: "Header schemes",
          })}
        </strong>
      </div>

      <div className="system-prompt-list custom-headers-scheme-list">
        {schemes.length === 0 ? (
          <div className="system-prompt-empty">
            {t("settings.customHeadersNoSchemes", {
              defaultValue:
                "No custom header schemes yet. Import from Snow CLI or add one manually.",
            })}
          </div>
        ) : (
          schemes.map((scheme) => {
            const activeLabel = scheme.isActive
              ? t("settings.customHeadersDeactivate", {
                  defaultValue: "Deactivate",
                })
              : t("settings.customHeadersActivate", {
                  defaultValue: "Activate",
                });
            const activeStateLabel = scheme.isActive
              ? t("settings.active", { defaultValue: "Active" })
              : t("settings.inactive", { defaultValue: "Inactive" });
            const preview = getHeaderPreview(scheme);

            return (
              <div
                key={scheme.schemeId}
                className={`system-prompt-item ${
                  scheme.isActive ? "active" : ""
                }`}
              >
                <div className="system-prompt-item-main">
                  <label
                    className="toggle-switch system-prompt-switch"
                    aria-label={activeLabel}
                    title={activeLabel}
                  >
                    <input
                      type="checkbox"
                      checked={scheme.isActive}
                      onChange={() => onToggleActive(scheme)}
                      disabled={isBusy}
                      hidden
                    />
                    <span className="toggle-slider" />
                    <span>{activeStateLabel}</span>
                  </label>
                  <div className="system-prompt-item-info">
                    <strong>{scheme.name}</strong>
                    <span>
                      {preview ||
                        t("settings.customHeadersNoHeaders", {
                          defaultValue: "No headers",
                        })}
                    </span>
                  </div>
                </div>
                <div className="system-prompt-item-actions">
                  <span className="custom-headers-count-badge">
                    {getHeaderCount(scheme)}
                  </span>
                  <button
                    className="icon-btn ghost"
                    onClick={() => onEdit(scheme)}
                    type="button"
                    aria-label={t("settings.edit", {
                      defaultValue: "Edit",
                    })}
                    title={t("settings.edit", { defaultValue: "Edit" })}
                    disabled={isBusy}
                  >
                    <Pencil size={14} strokeWidth={1.9} />
                  </button>
                  <button
                    className="icon-btn ghost danger"
                    onClick={() => onDelete(scheme)}
                    type="button"
                    aria-label={t("settings.delete", {
                      defaultValue: "Delete",
                    })}
                    title={t("settings.delete", {
                      defaultValue: "Delete",
                    })}
                    disabled={isBusy}
                  >
                    <Trash2 size={14} strokeWidth={1.9} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
