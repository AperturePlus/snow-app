import { Database } from "lucide-react";
import type { ChatCommand } from "./types";

export const createCodebaseCommand = (
  onOpenPanel: () => void,
  description: string,
  disabled: boolean
): ChatCommand => ({
  id: "codebase",
  label: "codebase",
  description,
  icon: Database,
  disabled,
  execute: onOpenPanel,
});
