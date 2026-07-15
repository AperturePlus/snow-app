import { Sparkles } from "lucide-react";
import type { ChatCommand } from "./types";

export const createSkillsCommand = (
  onOpenPanel: () => void,
  description: string,
  disabled: boolean
): ChatCommand => ({
  id: "skills",
  label: "skills",
  description,
  icon: Sparkles,
  disabled,
  execute: onOpenPanel,
});
