import { ipcRenderer, type IpcRendererEvent } from "electron";
import type {
  GitBranch,
  GitCheckoutResult,
  GitCommitResult,
  GitDiffResult,
  GitPushPullResult,
  GitStageResult,
  GitStatusResult,
} from "../types";

export const gitApi = {
  gitStatus: (repoPath: string): Promise<GitStatusResult> =>
    ipcRenderer.invoke("git:status", repoPath),
  startGitWatch: (repoPath: string): Promise<void> =>
    ipcRenderer.invoke("git:start-watch", repoPath),
  stopGitWatch: (repoPath: string): Promise<void> =>
    ipcRenderer.invoke("git:stop-watch", repoPath),
  onGitStatusChanged: (callback: (repoPath: string) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, repoPath: string): void => {
      callback(repoPath);
    };

    ipcRenderer.on("git:status-changed", handler);

    return () => {
      ipcRenderer.removeListener("git:status-changed", handler);
    };
  },
  gitBranches: (repoPath: string): Promise<GitBranch[]> =>
    ipcRenderer.invoke("git:branches", repoPath),
  gitStage: (repoPath: string, filePaths: string[]): Promise<GitStageResult> =>
    ipcRenderer.invoke("git:stage", repoPath, filePaths),
  gitUnstage: (
    repoPath: string,
    filePaths: string[]
  ): Promise<GitStageResult> =>
    ipcRenderer.invoke("git:unstage", repoPath, filePaths),
  gitStageAll: (repoPath: string): Promise<GitStageResult> =>
    ipcRenderer.invoke("git:stage-all", repoPath),
  gitUnstageAll: (repoPath: string): Promise<GitStageResult> =>
    ipcRenderer.invoke("git:unstage-all", repoPath),
  gitCommit: (repoPath: string, message: string): Promise<GitCommitResult> =>
    ipcRenderer.invoke("git:commit", repoPath, message),
  gitPush: (repoPath: string): Promise<GitPushPullResult> =>
    ipcRenderer.invoke("git:push", repoPath),
  gitPull: (repoPath: string): Promise<GitPushPullResult> =>
    ipcRenderer.invoke("git:pull", repoPath),
  gitCheckout: (
    repoPath: string,
    branchName: string
  ): Promise<GitCheckoutResult> =>
    ipcRenderer.invoke("git:checkout", repoPath, branchName),
  gitFileDiff: (
    repoPath: string,
    filePath: string,
    staged: boolean
  ): Promise<GitDiffResult> =>
    ipcRenderer.invoke("git:file-diff", repoPath, filePath, staged),
};
