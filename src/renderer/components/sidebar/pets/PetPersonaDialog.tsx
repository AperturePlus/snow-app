/**
 * 宠物人设编辑弹窗（受控组件，草稿由父面板持有）。
 *
 * 每只宠物可以自定义一份人设文本：宠物聊天构建系统提示词时把它写进
 * Persona 段，留空则回落到宠物包自带的默认人设（pet.json 的 description）。
 */
import { useRef } from "react";
import { useI18n } from "../../../i18n";
import { FormDialog } from "../../common/FormDialog";

type PetPersonaDialogProps = {
  open: boolean;
  /** 被编辑宠物的展示名（仅用于标题）。 */
  petName: string;
  /** 宠物包自带的默认人设，作为参考提示展示。 */
  defaultPersona: string;
  /** 当前编辑中的文本。 */
  value: string;
  isSaving: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  onClose: () => void;
};

export function PetPersonaDialog({
  open,
  petName,
  defaultPersona,
  value,
  isSaving,
  onChange,
  onSave,
  onClose,
}: PetPersonaDialogProps): React.JSX.Element {
  const { t } = useI18n();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fallback = defaultPersona.trim();

  return (
    <FormDialog
      open={open}
      title={t("settings.petsPersonaDialogTitle", {
        values: { name: petName },
        defaultValue: 'Edit persona for "{{name}}"',
      })}
      confirmLabel={t("common.save", { defaultValue: "Save" })}
      cancelLabel={t("common.cancel", { defaultValue: "Cancel" })}
      isSubmitting={isSaving}
      initialFocusRef={textareaRef}
      onConfirm={onSave}
      onCancel={onClose}
    >
      <label className="api-settings-field wide">
        <span>
          {t("settings.petsPersonaLabel", { defaultValue: "Persona" })}
        </span>
        <textarea
          className="api-settings-field-textarea"
          disabled={isSaving}
          onChange={(event) => onChange(event.target.value)}
          placeholder={t("settings.petsPersonaPlaceholder", {
            defaultValue:
              "For example: a witty but caring old cat who speaks in short, warm sentences and loves to tease the user about their progress.",
          })}
          ref={textareaRef}
          rows={8}
          spellCheck={false}
          value={value}
        />
      </label>
      <span className="settings-item-description">
        {t("settings.petsPersonaInfo", {
          defaultValue:
            "This text becomes the persona of the pet chat system prompt. Leave it empty to use the persona that ships with the pet package.",
        })}
      </span>
      {fallback && (
        <span className="settings-item-description">
          {t("settings.petsPersonaDefaultHint", {
            values: { text: fallback },
            defaultValue: "Package default: {{text}}",
          })}
        </span>
      )}
    </FormDialog>
  );
}
