import { createClearCommand } from "./ClearCommand";
import { createCompactCommand } from "./CompactCommand";
import { createMcpCommand } from "./McpCommand";
import type { ChatCommand } from "./types";

type ChatCommandLabels = {
  clearDescription: string;
  compactDescription: string;
  mcpDescription: string;
};

type CreateChatCommandsOptions = {
  onNewChat: () => void;
  onCompactConversation?: (model?: string) => void | Promise<void>;
  onOpenMcpPanel: () => void;
  model?: string;
  compactDisabled: boolean;
  mcpDisabled: boolean;
  labels: ChatCommandLabels;
};

export const createChatCommands = ({
  onNewChat,
  onCompactConversation,
  onOpenMcpPanel,
  model,
  compactDisabled,
  mcpDisabled,
  labels,
}: CreateChatCommandsOptions): ChatCommand[] => {
  const commands: ChatCommand[] = [
    createClearCommand(onNewChat, labels.clearDescription),
    createMcpCommand(onOpenMcpPanel, labels.mcpDescription, mcpDisabled),
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
