import { ShieldAlert } from "lucide-react";
import type { ChatCommand } from "./types";

export const createSensitiveCommandsCommand = (
  onOpenPanel: () => void,
  description: string,
  disabled: boolean
): ChatCommand => ({
  id: "sensitive-commands",
  label: "sensitive",
  description,
  icon: ShieldAlert,
  disabled,
  execute: onOpenPanel,
});
