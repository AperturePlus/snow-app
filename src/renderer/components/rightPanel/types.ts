import type {
  GitDiffResult,
  GitFileStatus,
  WorkspaceDirectoryRecord,
} from "../../../preload";

export type RightPanelContentKey = "git" | "terminal" | "browser";

export type RightPanelContentProps = {
  activeDirectory?: WorkspaceDirectoryRecord | null;
};

export type DiffLine = {
  type: "context" | "add" | "del" | "hunk";
  content: string;
  oldNum: string;
  newNum: string;
};

export type DiffTabData = {
  filePath: string;
  selectedFile: GitFileStatus;
  diffResult: GitDiffResult | null;
  diffLoading: boolean;
};

export type TerminalTabData = {
  cwd: string;
};

export type BrowserTabData = {
  url: string;
};

export type RightPanelTab = {
  id: string;
  type: "git" | "diff" | "terminal" | "browser";
  title: string;
  data?: DiffTabData | TerminalTabData | BrowserTabData;
};

export type OpenDiffTabCallback = (
  file: GitFileStatus,
  diffResult: GitDiffResult | null,
  diffLoading: boolean
) => void;
