import type { WorkspaceDirectoryRecord } from "../../../preload";

export type RightPanelContentKey = "git";

export type RightPanelContentProps = {
  activeDirectory?: WorkspaceDirectoryRecord | null;
};

export type DiffLine = {
  type: "context" | "add" | "del" | "hunk";
  content: string;
  oldNum: string;
  newNum: string;
};
