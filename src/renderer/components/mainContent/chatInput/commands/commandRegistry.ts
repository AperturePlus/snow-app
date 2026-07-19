import { createClearCommand } from "./ClearCommand";
import { createCodebaseCommand } from "./CodebaseCommand";
import { createCompactCommand } from "./CompactCommand";
import { createMcpCommand } from "./McpCommand";
import { createSensitiveCommandsCommand } from "./SensitiveCommandsCommand";
import { createSkillsCommand } from "./SkillsCommand";
import type { ChatCommand } from "./types";

type ChatCommandLabels = {
  clearDescription: string;
  codebaseDescription: string;
  codebaseNoProject: string;
  compactDescription: string;
  mcpDescription: string;
  sensitiveCommandsDescription: string;
  skillsDescription: string;
};

type CreateChatCommandsOptions = {
  onNewChat: () => void;
  onCompactConversation?: (model?: string) => void | Promise<void>;
  onOpenMcpPanel: () => void;
  onOpenSensitiveCommandsPanel: () => void;
  onOpenSkillsPanel: () => void;
  onOpenCodebasePanel: () => void;
  model?: string;
  compactDisabled: boolean;
  mcpDisabled: boolean;
  sensitiveCommandsDisabled: boolean;
  skillsDisabled: boolean;
  codebaseDisabled: boolean;
  labels: ChatCommandLabels;
};

export const createChatCommands = ({
  onNewChat,
  onCompactConversation,
  onOpenMcpPanel,
  onOpenSensitiveCommandsPanel,
  onOpenSkillsPanel,
  onOpenCodebasePanel,
  model,
  compactDisabled,
  mcpDisabled,
  sensitiveCommandsDisabled,
  skillsDisabled,
  codebaseDisabled,
  labels,
}: CreateChatCommandsOptions): ChatCommand[] => {
  const commands: ChatCommand[] = [
    createClearCommand(onNewChat, labels.clearDescription),
    createMcpCommand(onOpenMcpPanel, labels.mcpDescription, mcpDisabled),
    createSensitiveCommandsCommand(
      onOpenSensitiveCommandsPanel,
      labels.sensitiveCommandsDescription,
      sensitiveCommandsDisabled
    ),
    createSkillsCommand(
      onOpenSkillsPanel,
      labels.skillsDescription,
      skillsDisabled
    ),
    createCodebaseCommand(
      onOpenCodebasePanel,
      codebaseDisabled ? labels.codebaseNoProject : labels.codebaseDescription,
      codebaseDisabled
    ),
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
