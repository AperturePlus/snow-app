import type {
  FileContentResult,
  GitDiffResult,
  GitFileStatus,
  WorkspaceDirectoryRecord,
} from "../../../preload";

export type RightPanelContentKey = "git" | "terminal" | "browser" | "file";

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
  instanceId: string;
  url: string;
};

export type FileViewerTabData = {
  filePath: string;
  fileName: string;
  isSsh: boolean;
  sshSessionId?: string | null;
};

export type RightPanelTab = {
  id: string;
  type: "git" | "diff" | "terminal" | "browser" | "file";
  title: string;
  data?: DiffTabData | TerminalTabData | BrowserTabData | FileViewerTabData;
};

export type OpenDiffTabCallback = (
  file: GitFileStatus,
  diffResult: GitDiffResult | null,
  diffLoading: boolean
) => void;

export type OpenFileTabCallback = (
  filePath: string,
  fileName: string,
  isSsh: boolean,
  sshSessionId?: string | null
) => void;

export type { FileContentResult };
