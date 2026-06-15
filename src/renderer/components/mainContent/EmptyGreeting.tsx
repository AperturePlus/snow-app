import { PixelLogo } from "../common/PixelLogo";
import { useI18n } from "../../i18n";
import type { WorkspaceDirectoryRecord } from "../../../preload";

type EmptyGreetingProps = {
  activeDirectory?: WorkspaceDirectoryRecord | null;
};

export const EmptyGreeting = ({
  activeDirectory,
}: EmptyGreetingProps): React.JSX.Element => {
  const { t } = useI18n();

  return (
    <div className="chat-empty-greeting">
      <div className="chat-empty-greeting-brand">
        <PixelLogo className="chat-empty-greeting-logo" />
      </div>
      <p className="chat-empty-greeting-title">
        {activeDirectory
          ? t("chat.greetingWithProject", {
              defaultValue: "What would you like to work on in {{name}}?",
              values: { name: activeDirectory.name },
            })
          : t("chat.greetingNoProject", {
              defaultValue: "Select a workspace project to get started.",
            })}
      </p>
    </div>
  );
};
