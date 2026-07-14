import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import { useI18n } from "../../../../i18n";
import type { ChatCommand } from "./types";

export type CommandPanelHandle = {
  handleKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => boolean;
};

type CommandPanelProps = {
  commands: ChatCommand[];
  query: string;
  visible: boolean;
  onClose: () => void;
  onSelect: (command: ChatCommand) => void;
};
export const CommandPanel = forwardRef<CommandPanelHandle, CommandPanelProps>(
  function CommandPanel({ commands, query, visible, onClose, onSelect }, ref) {
    const { t } = useI18n();
    const [selectedIndex, setSelectedIndex] = useState(0);

    const filteredCommands = useMemo(() => {
      const normalizedQuery = query.trim().toLowerCase();
      if (!normalizedQuery) {
        return commands;
      }

      return commands.filter((command) =>
        command.label.toLowerCase().includes(normalizedQuery)
      );
    }, [commands, query]);

    useEffect(() => {
      setSelectedIndex(0);
    }, [query, visible]);

    useImperativeHandle(
      ref,
      () => ({
        handleKeyDown: (event): boolean => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
            return true;
          }

          if (filteredCommands.length === 0) {
            return false;
          }

          if (event.key === "ArrowDown") {
            event.preventDefault();
            setSelectedIndex((index) =>
              index < filteredCommands.length - 1 ? index + 1 : index
            );
            return true;
          }

          if (event.key === "ArrowUp") {
            event.preventDefault();
            setSelectedIndex((index) => (index > 0 ? index - 1 : 0));
            return true;
          }

          if (event.key === "Enter") {
            event.preventDefault();
            const command = filteredCommands[selectedIndex];
            if (command) {
              onSelect(command);
            }
            return true;
          }

          return false;
        },
      }),
      [filteredCommands, onClose, onSelect, selectedIndex]
    );

    if (!visible) {
      return null;
    }
    return (
      <div
        className="chat-command-panel"
        role="listbox"
        aria-label={t("chatCommand.title")}
      >
        <div className="chat-command-list">
          {filteredCommands.length > 0 ? (
            filteredCommands.map((command, index) => {
              const CommandIcon = command.icon;
              const isSelected = index === selectedIndex;

              return (
                <button
                  key={command.id}
                  className={`chat-command-item${
                    isSelected ? " selected" : ""
                  }`}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  disabled={command.disabled}
                  onMouseEnter={() => setSelectedIndex(index)}
                  onClick={() => onSelect(command)}
                >
                  <CommandIcon size={15} className="chat-command-item-icon" />
                  <span className="chat-command-item-content">
                    <span className="chat-command-item-name">
                      /{command.label}
                    </span>
                    <span className="chat-command-item-description">
                      {command.description}
                    </span>
                  </span>
                </button>
              );
            })
          ) : (
            <div className="chat-command-empty">{t("chatCommand.empty")}</div>
          )}
        </div>
        <div className="chat-command-footer">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> {t("chatCommand.navigate")}
          </span>
          <span>
            <kbd>Enter</kbd> {t("chatCommand.execute")}
          </span>
          <span>
            <kbd>Esc</kbd> {t("chatCommand.close")}
          </span>
        </div>
      </div>
    );
  }
);
