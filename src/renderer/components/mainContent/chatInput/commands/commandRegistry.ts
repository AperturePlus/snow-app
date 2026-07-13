import { createClearCommand } from "./ClearCommand";
import { createCompactCommand } from "./CompactCommand";
import type { ChatCommand } from "./types";

type ChatCommandLabels = {
  clearDescription: string;
  compactDescription: string;
};

type CreateChatCommandsOptions = {
  onNewChat: () => void;
  onCompactConversation?: (model?: string) => void | Promise<void>;
  model?: string;
  compactDisabled: boolean;
  labels: ChatCommandLabels;
};

export const createChatCommands = ({
  onNewChat,
  onCompactConversation,
  model,
  compactDisabled,
  labels,
}: CreateChatCommandsOptions): ChatCommand[] => {
  const commands: ChatCommand[] = [
    createClearCommand(onNewChat, labels.clearDescription),
  ];

  if (onCompactConversation) {
    commands.push(
      createCompactCommand(
        onCompactConversation,
        model,
        labels.compactDescription,
        compactDisabled
      )
    );
  }

  return commands;
};
