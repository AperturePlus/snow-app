import {
  Activity,
  BrainCircuit,
  ChevronsUp,
  CircleDot,
  CircleOff,
  Gauge,
  Rocket,
} from "lucide-react";
import type { RequestMethod, ThinkingOption } from "./types";

export const MAX_TEXTAREA_ROWS = 8;
export const DEFAULT_TEXTAREA_ROWS = 2;
export const DEFAULT_THINKING_VALUE = "high";

export const THINKING_OPTIONS_BY_METHOD: Record<
  RequestMethod,
  ThinkingOption[]
> = {
  anthropic: [
    { value: "none", label: "None", icon: CircleOff },
    { value: "low", label: "Low", icon: Gauge },
    { value: "medium", label: "Medium", icon: Activity },
    { value: "high", label: "High", icon: BrainCircuit },
    { value: "max", label: "Max", icon: Rocket },
  ],
  gemini: [
    { value: "none", label: "None", icon: CircleOff },
    { value: "minimal", label: "Minimal", icon: CircleDot },
    { value: "low", label: "Low", icon: Gauge },
    { value: "medium", label: "Medium", icon: Activity },
    { value: "high", label: "High", icon: BrainCircuit },
  ],
  responses: [
    { value: "none", label: "None", icon: CircleOff },
    { value: "low", label: "Low", icon: Gauge },
    { value: "medium", label: "Medium", icon: Activity },
    { value: "high", label: "High", icon: BrainCircuit },
    { value: "xhigh", label: "Extra High", icon: ChevronsUp },
  ],
  chat: [
    { value: "none", label: "None", icon: CircleOff },
    { value: "low", label: "Low", icon: Gauge },
    { value: "medium", label: "Medium", icon: Activity },
    { value: "high", label: "High", icon: BrainCircuit },
    { value: "max", label: "Max", icon: Rocket },
  ],
};
