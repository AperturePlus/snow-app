import { Loader2, Save, X } from "lucide-react";
import { useI18n } from "../../../i18n";
import { ApiSettingsFormFields } from "./ApiSettingsFormFields";
import type { ApiConfigFormData } from "./types";

type ApiSettingsFormPanelProps = {
  data: ApiConfigFormData;
  isSaving: boolean;
  isNew: boolean;
  onChange: (field: keyof ApiConfigFormData, value: string | boolean) => void;
  onCancel: () => void;
  onSave: () => void;
  saveLabel: string;
  asForm?: boolean;
};

export function ApiSettingsFormPanel({
  data,
  isSaving,
  isNew,
  onChange,
  onCancel,
  onSave,
  saveLabel,
  asForm = false,
}: ApiSettingsFormPanelProps): React.JSX.Element {
  const { t } = useI18n();
  const content = (
    <>
      <ApiSettingsFormFields
        data={data}
        onChange={onChange}
        disabled={isSaving}
        isNew={isNew}
      />
      <div className="api-settings-form-actions">
        <button
          className="api-settings-form-btn secondary"
          onClick={onCancel}
          type="button"
          disabled={isSaving}
        >
          <X size={15} strokeWidth={1.9} />
          <span>{t("settings.cancel", { defaultValue: "Cancel" })}</span>
        </button>
        <button
          className="api-settings-form-btn primary"
          onClick={asForm ? undefined : onSave}
          type={asForm ? "submit" : "button"}
          disabled={isSaving}
        >
          {isSaving ? (
            <Loader2 size={15} className="spin" />
          ) : (
            <Save size={15} strokeWidth={1.9} />
          )}
          <span>{saveLabel}</span>
        </button>
      </div>
    </>
  );

  if (asForm) {
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        {content}
      </form>
    );
  }

  return content;
}
