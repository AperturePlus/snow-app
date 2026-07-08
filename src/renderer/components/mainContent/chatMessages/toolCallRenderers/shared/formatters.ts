export const getFileName = (filePath: string): string =>
  filePath.split(/[\\/]/).filter(Boolean).pop() || filePath;

export const getToolDisplayName = (toolType: "edit" | "create"): string =>
  toolType === "edit" ? "edit" : "create";
