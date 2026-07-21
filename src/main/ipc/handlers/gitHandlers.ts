import { ipcMain } from "electron";
import type { NativeBridge, ResponsesApiStreamChunk } from "../../native/types";

const GIT_COMMIT_MSG_CHUNK_CHANNEL = "git:commit-msg:chunk";

export const registerGitHandlers = (native: NativeBridge): void => {
  // ===== Git file watcher handlers =====
  ipcMain.handle("git:start-watch", (event, repoPath: unknown) => {
    if (typeof repoPath !== "string" || !repoPath.trim()) {
      throw new Error("Repository path is required");
    }
    const trimmed = repoPath.trim();
    native.startGitWatch(trimmed, (changedRepoPath: string) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send("git:status-changed", changedRepoPath);
      }
    });
  });

  ipcMain.handle("git:stop-watch", (_event, repoPath: unknown) => {
    if (typeof repoPath !== "string" || !repoPath.trim()) {
      throw new Error("Repository path is required");
    }
    native.stopGitWatch(repoPath.trim());
  });

  // ===== Git handlers =====
  ipcMain.handle("git:status", async (_event, repoPath: unknown) => {
    if (typeof repoPath !== "string" || !repoPath.trim()) {
      throw new Error("Repository path is required");
    }
    return native.getGitStatus(repoPath.trim());
  });

  ipcMain.handle("git:branches", async (_event, repoPath: unknown) => {
    if (typeof repoPath !== "string" || !repoPath.trim()) {
      throw new Error("Repository path is required");
    }
    return native.getGitBranches(repoPath.trim());
  });

  ipcMain.handle(
    "git:stage",
    async (_event, repoPath: unknown, filePaths: unknown) => {
      if (typeof repoPath !== "string" || !repoPath.trim()) {
        throw new Error("Repository path is required");
      }
      const paths = Array.isArray(filePaths)
        ? filePaths.filter((f): f is string => typeof f === "string")
        : [];
      return native.gitStageFiles(repoPath.trim(), paths);
    }
  );

  ipcMain.handle(
    "git:unstage",
    async (_event, repoPath: unknown, filePaths: unknown) => {
      if (typeof repoPath !== "string" || !repoPath.trim()) {
        throw new Error("Repository path is required");
      }
      const paths = Array.isArray(filePaths)
        ? filePaths.filter((f): f is string => typeof f === "string")
        : [];
      return native.gitUnstageFiles(repoPath.trim(), paths);
    }
  );

  ipcMain.handle("git:stage-all", async (_event, repoPath: unknown) => {
    if (typeof repoPath !== "string" || !repoPath.trim()) {
      throw new Error("Repository path is required");
    }
    return native.gitStageAll(repoPath.trim());
  });

  ipcMain.handle("git:unstage-all", async (_event, repoPath: unknown) => {
    if (typeof repoPath !== "string" || !repoPath.trim()) {
      throw new Error("Repository path is required");
    }
    return native.gitUnstageAll(repoPath.trim());
  });

  ipcMain.handle(
    "git:commit",
    async (_event, repoPath: unknown, message: unknown) => {
      if (typeof repoPath !== "string" || !repoPath.trim()) {
        throw new Error("Repository path is required");
      }
      if (typeof message !== "string" || !message.trim()) {
        throw new Error("Commit message is required");
      }
      return native.gitCommit(repoPath.trim(), message);
    }
  );

  ipcMain.handle("git:push", async (_event, repoPath: unknown) => {
    if (typeof repoPath !== "string" || !repoPath.trim()) {
      throw new Error("Repository path is required");
    }
    return native.gitPush(repoPath.trim());
  });

  ipcMain.handle("git:pull", async (_event, repoPath: unknown) => {
    if (typeof repoPath !== "string" || !repoPath.trim()) {
      throw new Error("Repository path is required");
    }
    return native.gitPull(repoPath.trim());
  });

  ipcMain.handle(
    "git:checkout",
    async (_event, repoPath: unknown, branchName: unknown) => {
      if (typeof repoPath !== "string" || !repoPath.trim()) {
        throw new Error("Repository path is required");
      }
      if (typeof branchName !== "string" || !branchName.trim()) {
        throw new Error("Branch name is required");
      }
      return native.gitCheckout(repoPath.trim(), branchName.trim());
    }
  );

  ipcMain.handle(
    "git:create-branch",
    async (_event, repoPath: unknown, branchName: unknown) => {
      if (typeof repoPath !== "string" || !repoPath.trim()) {
        throw new Error("Repository path is required");
      }
      if (typeof branchName !== "string" || !branchName.trim()) {
        throw new Error("Branch name is required");
      }
      return native.gitCreateBranch(repoPath.trim(), branchName.trim());
    }
  );

  ipcMain.handle(
    "git:file-diff",
    async (_event, repoPath: unknown, filePath: unknown, staged: unknown) => {
      if (typeof repoPath !== "string" || !repoPath.trim()) {
        throw new Error("Repository path is required");
      }
      if (typeof filePath !== "string" || !filePath.trim()) {
        throw new Error("File path is required");
      }
      return native.gitFileDiff(
        repoPath.trim(),
        filePath.trim(),
        staged === true
      );
    }
  );

  ipcMain.handle(
    "git:discard",
    async (_event, repoPath: unknown, filePaths: unknown) => {
      if (typeof repoPath !== "string" || !repoPath.trim()) {
        throw new Error("Repository path is required");
      }
      const paths = Array.isArray(filePaths)
        ? filePaths.filter((f): f is string => typeof f === "string")
        : [];
      return native.gitDiscardChanges(repoPath.trim(), paths);
    }
  );

  ipcMain.handle(
    "git:log",
    async (_event, repoPath: unknown, skip: unknown, limit: unknown) => {
      if (typeof repoPath !== "string" || !repoPath.trim()) {
        throw new Error("Repository path is required");
      }
      const skipCount =
        typeof skip === "number" && skip > 0 ? Math.floor(skip) : 0;
      const maxCount = typeof limit === "number" && limit > 0 ? limit : 50;
      return native.getGitLog(repoPath.trim(), skipCount, maxCount);
    }
  );

  ipcMain.handle(
    "git:commit-files",
    async (_event, repoPath: unknown, hash: unknown) => {
      if (typeof repoPath !== "string" || !repoPath.trim()) {
        throw new Error("Repository path is required");
      }
      if (typeof hash !== "string" || !hash.trim()) {
        throw new Error("Commit hash is required");
      }
      return native.getGitCommitFiles(repoPath.trim(), hash.trim());
    }
  );
  // ===== AI commit message generation =====
  ipcMain.handle(
    "git:generate-commit-message",
    async (event, repoPath: unknown, streamId: unknown) => {
      if (typeof repoPath !== "string" || !repoPath.trim()) {
        throw new Error("Repository path is required");
      }
      if (typeof streamId !== "string" || !streamId.trim()) {
        throw new Error("Stream ID is required");
      }

      const normalizedStreamId = streamId.trim();

      return await native.generateCommitMessage(
        repoPath.trim(),
        (chunk: ResponsesApiStreamChunk) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send(GIT_COMMIT_MSG_CHUNK_CHANNEL, {
              streamId: normalizedStreamId,
              chunk,
            });
          }
        },
        normalizedStreamId
      );
    }
  );
};
