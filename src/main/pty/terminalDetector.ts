import { existsSync } from "node:fs";

export type DetectedTerminal = {
  name: string;
  path: string;
  family: "powershell" | "cmd" | "posix";
};

export type TerminalFamily = DetectedTerminal["family"];

export const detectShellFamily = (shellPath: string): TerminalFamily => {
  const base = shellPath
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    ?.toLowerCase()
    .replace(/\.exe$/, "");

  if (!base) {
    return "posix";
  }

  if (base === "cmd") {
    return "cmd";
  }

  if (base === "powershell" || base === "pwsh") {
    return "powershell";
  }

  return "posix";
};

export const getDefaultShellArgs = (family: TerminalFamily): string[] => {
  switch (family) {
    case "powershell":
      return ["-NoLogo", "-NoExit"];
    case "cmd":
      return [];
    case "posix":
      return ["-l"];
  }
};

export const validateShellPath = (shellPath: string): boolean => {
  if (!shellPath.trim()) {
    return false;
  }
  try {
    return existsSync(shellPath.trim());
  } catch {
    return false;
  }
};
