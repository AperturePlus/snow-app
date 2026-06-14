import { Loader2, Pencil, Trash2 } from "lucide-react";
import { useI18n } from "../../../i18n";
import {
  DISABLED_STATUS_LABEL,
  ENABLED_STATUS_LABEL,
} from "./apiSettingsConstants";
import type { ApiConfigItem } from "./types";

type ApiSettingsTableProps = {
  configs: ApiConfigItem[];
  isLoading: boolean;
  onEdit: (config: ApiConfigItem) => void;
  onDelete: (profileName: string, displayName: string) => void;
  onToggleActive: (config: ApiConfigItem) => void;
};

export function ApiSettingsTable({
  configs,
  isLoading,
  onEdit,
  onDelete,
  onToggleActive,
}: ApiSettingsTableProps): React.JSX.Element {
  const { t } = useI18n();

  return (
    <div
      className="api-settings-table-wrap"
      aria-label={t("settings.apiConfigTable", {
        defaultValue: "API configuration table",
      })}
    >
      {isLoading && configs.length === 0 ? (
        <div className="api-settings-empty">
          <Loader2 size={16} className="spin" />
          {t("settings.loadingApiConfigs", {
            defaultValue: "Loading API configs...",
          })}
        </div>
      ) : configs.length === 0 ? (
        <div className="api-settings-empty">
          {t("settings.noApiConfigs", {
            defaultValue:
              "No API profiles yet. Import Snow CLI profiles or add one manually.",
          })}
        </div>
      ) : (
        <table className="api-settings-table">
          <thead>
            <tr>
              <th>{t("settings.tableName", { defaultValue: "Name" })}</th>
              <th>{t("settings.tableBaseUrl", { defaultValue: "Base URL" })}</th>
              <th>{t("settings.tableModel", { defaultValue: "Model" })}</th>
              <th>{t("settings.tableMethod", { defaultValue: "Method" })}</th>
              <th>{t("settings.tableStatus", { defaultValue: "Status" })}</th>
              <th className="api-settings-table-actions-col">
                {t("settings.tableActions", { defaultValue: "Actions" })}
              </th>
            </tr>
          </thead>
          <tbody>
            {configs.map((config) => (
              <tr key={config.profileName}>
                <td className="cell-name">
                  <strong>{config.displayName}</strong>
                  <small className="profile-name-hint">{config.profileName}</small>
                </td>
                <td className="cell-url">{config.baseUrl || "-"}</td>
                <td>{config.advancedModel || config.basicModel || "-"}</td>
                <td>
                  <span className="badge method">{config.requestMethod}</span>
                </td>
                <td>
                  <button
                    className={
                      config.isActive
                        ? "badge active clickable"
                        : "badge inactive clickable"
                    }
                    onClick={() => onToggleActive(config)}
                    type="button"
                    disabled={config.isActive}
                    title={
                      config.isActive
                        ? t("settings.activeProfile", {
                            defaultValue: "Enabled profile",
                          })
                        : t("settings.clickToActivate", {
                            defaultValue: "Click to enable this profile",
                          })
                    }
                  >
                    {config.isActive
                      ? t("settings.active", {
                          defaultValue: ENABLED_STATUS_LABEL,
                        })
                      : t("settings.inactive", {
                          defaultValue: DISABLED_STATUS_LABEL,
                        })}
                  </button>
                </td>
                <td className="api-settings-table-actions-col">
                  <div className="api-settings-table-actions">
                    <button
                      className="icon-btn ghost"
                      onClick={() => onEdit(config)}
                      type="button"
                      title={t("settings.edit", { defaultValue: "Edit" })}
                      aria-label={t("settings.edit", { defaultValue: "Edit" })}
                    >
                      <Pencil size={13} strokeWidth={1.8} />
                    </button>
                    <button
                      className="icon-btn ghost danger"
                      onClick={() => onDelete(config.profileName, config.displayName)}
                      type="button"
                      title={t("settings.delete", { defaultValue: "Delete" })}
                      aria-label={t("settings.delete", { defaultValue: "Delete" })}
                    >
                      <Trash2 size={13} strokeWidth={1.8} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
