import { UserCog } from "lucide-react";
import type { ChatCommand } from "./types";

export const createRoleCommand = (
  onOpenPanel: () => void,
  description: string,
  disabled: boolean
): ChatCommand => ({
  id: "role",
  label: "role",
  description,
  icon: UserCog,
  disabled,
  execute: onOpenPanel,
});
