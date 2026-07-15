import { Blocks } from "lucide-react";
import type { ChatCommand } from "./types";

export const createMcpCommand = (
  onOpenMcpPanel: () => void,
  description: string,
  disabled: boolean
): ChatCommand => ({
  id: "mcp",
  label: "mcp",
  description,
  icon: Blocks,
  disabled,
  execute: onOpenMcpPanel,
});
