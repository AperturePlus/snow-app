import { Download, Loader2, Plus, X } from "lucide-react";
import { useI18n } from "../../../i18n";

type ApiSettingsActionsProps = {
  isBusy: boolean;
  isLoading: boolean;
  showAddForm: boolean;
  onImport: () => void;
  onToggleAddForm: () => void;
};

export function ApiSettingsActions({
  isBusy,
  isLoading,
  showAddForm,
  onImport,
  onToggleAddForm,
}: ApiSettingsActionsProps): React.JSX.Element {
  const { t } = useI18n();

  return (
    <div className="api-settings-actions">
      <button
        className="api-settings-action-btn primary"
        onClick={onImport}
        type="button"
        disabled={isBusy}
      >
        {isLoading ? (
          <Loader2 size={15} className="spin" />
        ) : (
          <Download size={15} />
        )}
        <span>
          {t("settings.importFromSnowCli", {
            defaultValue: "Sync Snow CLI API config",
          })}
        </span>
      </button>
      <button
        className="api-settings-action-btn secondary"
        onClick={onToggleAddForm}
        type="button"
        disabled={isBusy}
      >
        {showAddForm ? <X size={15} /> : <Plus size={15} />}
        <span>
          {showAddForm
            ? t("settings.cancelManualApiConfig", {
                defaultValue: "Cancel manual add",
              })
            : t("settings.addManualApiConfig", {
                defaultValue: "Add manually",
              })}
        </span>
      </button>
    </div>
  );
}
