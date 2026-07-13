import type { LucideIcon } from "lucide-react";

export type ChatCommand = {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  disabled?: boolean;
  execute: () => void;
};
