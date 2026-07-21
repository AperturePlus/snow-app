import { createClearCommand } from "./ClearCommand";
import { createCodebaseCommand } from "./CodebaseCommand";
import { createCompactCommand } from "./CompactCommand";
import { createMcpCommand } from "./McpCommand";
import { createRoleCommand } from "./RoleCommand";
import { createSensitiveCommandsCommand } from "./SensitiveCommandsCommand";
import { createSkillsCommand } from "./SkillsCommand";
import type { ChatCommand } from "./types";

type ChatCommandLabels = {
  clearDescription: string;
  codebaseDescription: string;
  codebaseNoProject: string;
  compactDescription: string;
  mcpDescription: string;
  roleDescription: string;
  roleNoProject: string;
  sensitiveCommandsDescription: string;
  skillsDescription: string;
};

type CreateChatCommandsOptions = {
  onNewChat: () => void;
  onCompactConversation?: (model?: string) => void | Promise<void>;
  onOpenMcpPanel: () => void;
  onOpenRolePanel: () => void;
  onOpenSensitiveCommandsPanel: () => void;
  onOpenSkillsPanel: () => void;
  onOpenCodebasePanel: () => void;
  model?: string;
  compactDisabled: boolean;
  mcpDisabled: boolean;
  roleDisabled: boolean;
  sensitiveCommandsDisabled: boolean;
  skillsDisabled: boolean;
  codebaseDisabled: boolean;
  labels: ChatCommandLabels;
};

export const createChatCommands = ({
  onNewChat,
  onCompactConversation,
  onOpenMcpPanel,
  onOpenRolePanel,
  onOpenSensitiveCommandsPanel,
  onOpenSkillsPanel,
  onOpenCodebasePanel,
  model,
  compactDisabled,
  mcpDisabled,
  roleDisabled,
  sensitiveCommandsDisabled,
  skillsDisabled,
  codebaseDisabled,
  labels,
}: CreateChatCommandsOptions): ChatCommand[] => {
  const commands: ChatCommand[] = [
    createClearCommand(onNewChat, labels.clearDescription),
    createMcpCommand(onOpenMcpPanel, labels.mcpDescription, mcpDisabled),
    createRoleCommand(
      onOpenRolePanel,
      roleDisabled ? labels.roleNoProject : labels.roleDescription,
      roleDisabled
    ),
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
