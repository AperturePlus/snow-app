import { ipcRenderer, type IpcRendererEvent } from "electron";
import type {
  BashStreamChunk,
  BrowserCommandRequest,
  BrowserCommandResponse,
  CheckpointFileChange,
  CheckpointFileDiff,
  CodebaseEmbedProgress,
  CodebaseIndexStats,
  CodebaseProjectScopeSettings,
  CodebaseScanPreview,
  CodebaseSyncProgress,
  CodebaseSyncResult,
  McpProjectServerStatus,
  McpProjectToolStatus,
  McpToolDefinition,
  ProjectSkillDefinition,
  ResumableCodebaseSession,
  SkillDefinition,
  UserQuestionRequest,
  UserQuestionResponse,
} from "../types";

const MCP_TOOL_CHUNK_CHANNEL = "mcp:call-tool:chunk";
const BROWSER_COMMAND_CHANNEL = "browser:command";
const BROWSER_COMMAND_RESPONSE_CHANNEL = "browser:command-response";
const USER_QUESTION_CHANNEL = "user-question:request";
const USER_QUESTION_RESPONSE_CHANNEL = "user-question:response";
const CODEBASE_EMBED_PROGRESS_CHANNEL = "codebase:embed:progress";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const createMcpToolStreamId = (): string =>
  `tool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const normalizeBashStreamChunk = (value: unknown): BashStreamChunk | null => {
  if (
    !isRecord(value) ||
    (value.stream !== "stdout" && value.stream !== "stderr") ||
    typeof value.data !== "string"
  ) {
    return null;
  }

  return { stream: value.stream, data: value.data };
};

const mcpToolChunkCallbacks = new Map<
  string,
  (chunk: BashStreamChunk) => void
>();
let mcpToolChunkListenerRegistered = false;

const ensureMcpToolChunkListener = (): void => {
  if (mcpToolChunkListenerRegistered) {
    return;
  }
  mcpToolChunkListenerRegistered = true;
  ipcRenderer.on(MCP_TOOL_CHUNK_CHANNEL, (_event, payload: unknown) => {
    if (!isRecord(payload)) {
      return;
    }
    const streamId = payload.streamId;
    if (typeof streamId !== "string") {
      return;
    }
    const callback = mcpToolChunkCallbacks.get(streamId);
    if (!callback) {
      return;
    }
    const chunk = normalizeBashStreamChunk(payload.chunk);
    if (chunk) {
      callback(chunk);
    }
  });
};

const codebaseEmbedProgressCallbacks = new Map<
  string,
  (progress: CodebaseEmbedProgress) => void
>();
let codebaseEmbedProgressListenerRegistered = false;

const ensureCodebaseEmbedProgressListener = (): void => {
  if (codebaseEmbedProgressListenerRegistered) {
    return;
  }
  codebaseEmbedProgressListenerRegistered = true;
  ipcRenderer.on(
    CODEBASE_EMBED_PROGRESS_CHANNEL,
    (_event, payload: unknown) => {
      if (!isRecord(payload)) {
        return;
      }
      const sessionId = payload.sessionId;
      if (typeof sessionId !== "string") {
        return;
      }
      const callback = codebaseEmbedProgressCallbacks.get(sessionId);
      if (!callback) {
        return;
      }
      const progress = payload.progress;
      if (!isRecord(progress)) {
        return;
      }
      callback({
        phase: typeof progress.phase === "string" ? progress.phase : "",
        totalFiles:
          typeof progress.totalFiles === "number" ? progress.totalFiles : 0,
        processedFiles:
          typeof progress.processedFiles === "number"
            ? progress.processedFiles
            : 0,
        totalChunks:
          typeof progress.totalChunks === "number" ? progress.totalChunks : 0,
        processedChunks:
          typeof progress.processedChunks === "number"
            ? progress.processedChunks
            : 0,
        currentFile:
          typeof progress.currentFile === "string" ? progress.currentFile : "",
        error: typeof progress.error === "string" ? progress.error : "",
        elapsedMs:
          typeof progress.elapsedMs === "number" ? progress.elapsedMs : 0,
      });
    }
  );
};

export const systemApi = {
  getCodebaseProjectScopeSettings: (
    projectId: string
  ): Promise<CodebaseProjectScopeSettings> =>
    ipcRenderer.invoke("codebase:get-project-scope", projectId),
  setCodebaseProjectEnabled: (
    projectId: string,
    enabled: boolean
  ): Promise<void> =>
    ipcRenderer.invoke("codebase:set-project-enabled", projectId, enabled),
  setCodebaseProjectAgentReview: (
    projectId: string,
    enabled: boolean
  ): Promise<void> =>
    ipcRenderer.invoke("codebase:set-project-agent-review", projectId, enabled),
  setCodebaseProjectReranking: (
    projectId: string,
    enabled: boolean
  ): Promise<void> =>
    ipcRenderer.invoke("codebase:set-project-reranking", projectId, enabled),
  checkProjectHasGitignore: (projectId: string): Promise<boolean> =>
    ipcRenderer.invoke("codebase:check-project-gitignore", projectId),
  startCodebaseEmbedding: (
    projectId: string,
    sessionId: string,
    onProgress?: (progress: CodebaseEmbedProgress) => void
  ): Promise<void> => {
    ensureCodebaseEmbedProgressListener();
    if (onProgress) {
      codebaseEmbedProgressCallbacks.set(sessionId, onProgress);
    }
    return ipcRenderer
      .invoke("codebase:start-embedding", projectId, sessionId)
      .finally(() => {
        codebaseEmbedProgressCallbacks.delete(sessionId);
      });
  },
  pauseCodebaseEmbedding: (sessionId: string): Promise<boolean> =>
    ipcRenderer.invoke("codebase:pause-embedding", sessionId),
  resumeCodebaseEmbedding: (sessionId: string): Promise<boolean> =>
    ipcRenderer.invoke("codebase:resume-embedding", sessionId),
  cancelCodebaseEmbedding: (sessionId: string): Promise<boolean> =>
    ipcRenderer.invoke("codebase:cancel-embedding", sessionId),
  getCodebaseIndexStats: (projectId: string): Promise<CodebaseIndexStats> =>
    ipcRenderer.invoke("codebase:get-index-stats", projectId),
  clearCodebaseIndex: (projectId: string): Promise<void> =>
    ipcRenderer.invoke("codebase:clear-index", projectId),
  startCodebaseWatch: (projectId: string, projectPath: string): Promise<void> =>
    ipcRenderer.invoke("codebase:start-watch", projectId, projectPath),
  stopCodebaseWatch: (projectId: string): Promise<void> =>
    ipcRenderer.invoke("codebase:stop-watch", projectId),
  syncCodebaseChanges: (
    projectId: string,
    onProgress?: (progress: CodebaseSyncProgress) => void
  ): Promise<CodebaseSyncResult> => {
    if (onProgress) {
      const handler = (_event: IpcRendererEvent, payload: unknown) => {
        if (!isRecord(payload)) {
          return;
        }
        const progress = payload.progress;
        if (!isRecord(progress)) {
          return;
        }
        onProgress({
          phase: typeof progress.phase === "string" ? progress.phase : "",
          filesToEmbed:
            typeof progress.filesToEmbed === "number"
              ? progress.filesToEmbed
              : 0,
          processedFiles:
            typeof progress.processedFiles === "number"
              ? progress.processedFiles
              : 0,
          deletedFiles:
            typeof progress.deletedFiles === "number"
              ? progress.deletedFiles
              : 0,
          skippedFiles:
            typeof progress.skippedFiles === "number"
              ? progress.skippedFiles
              : 0,
          currentFile:
            typeof progress.currentFile === "string"
              ? progress.currentFile
              : "",
          error: typeof progress.error === "string" ? progress.error : "",
        });
      };
      ipcRenderer.on("codebase:sync:progress", handler);
      return ipcRenderer
        .invoke("codebase:sync-changes", projectId)
        .finally(() => {
          ipcRenderer.removeListener("codebase:sync:progress", handler);
        });
    }
    return ipcRenderer.invoke("codebase:sync-changes", projectId);
  },
  onCodebaseFilesChanged: (
    callback: (projectId: string) => void
  ): (() => void) => {
    const handler = (_event: IpcRendererEvent, projectId: string): void => {
      callback(projectId);
    };

    ipcRenderer.on("codebase:files-changed", handler);

    return () => {
      ipcRenderer.removeListener("codebase:files-changed", handler);
    };
  },
  onCodebaseSyncProgress: (
    callback: (progress: CodebaseSyncProgress) => void
  ): (() => void) => {
    const handler = (_event: IpcRendererEvent, payload: unknown): void => {
      if (!isRecord(payload)) {
        return;
      }
      const progress = payload.progress;
      if (!isRecord(progress)) {
        return;
      }
      callback({
        phase: typeof progress.phase === "string" ? progress.phase : "",
        filesToEmbed:
          typeof progress.filesToEmbed === "number" ? progress.filesToEmbed : 0,
        processedFiles:
          typeof progress.processedFiles === "number"
            ? progress.processedFiles
            : 0,
        deletedFiles:
          typeof progress.deletedFiles === "number" ? progress.deletedFiles : 0,
        skippedFiles:
          typeof progress.skippedFiles === "number" ? progress.skippedFiles : 0,
        currentFile:
          typeof progress.currentFile === "string" ? progress.currentFile : "",
        error: typeof progress.error === "string" ? progress.error : "",
      });
    };

    ipcRenderer.on("codebase:sync:progress", handler);

    return () => {
      ipcRenderer.removeListener("codebase:sync:progress", handler);
    };
  },
  previewCodebaseScan: (projectId: string): Promise<CodebaseScanPreview> =>
    ipcRenderer.invoke("codebase:preview-scan", projectId),
  getResumableCodebaseSessions: (
    projectId: string
  ): Promise<ResumableCodebaseSession[]> =>
    ipcRenderer.invoke("codebase:get-resumable-sessions", projectId),
  discardResumableCodebaseSession: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke("codebase:discard-resumable-session", sessionId),
  listMcpTools: (): Promise<McpToolDefinition[]> =>
    ipcRenderer.invoke("mcp:list-tools"),
  listAvailableSkills: (projectId?: string): Promise<SkillDefinition[]> =>
    ipcRenderer.invoke("skills:list", projectId),
  setSkillEnabled: (
    projectId: string | undefined,
    skillId: string,
    enabled: boolean
  ): Promise<void> =>
    ipcRenderer.invoke("skills:set-enabled", projectId, skillId, enabled),
  listProjectSkills: (projectId: string): Promise<ProjectSkillDefinition[]> =>
    ipcRenderer.invoke("skills:list-project", projectId),
  setProjectSkillEnabled: (
    projectId: string,
    skillId: string,
    enabled: boolean
  ): Promise<void> =>
    ipcRenderer.invoke(
      "skills:set-project-enabled",
      projectId,
      skillId,
      enabled
    ),
  listMcpServerTools: (configServerId: string): Promise<McpToolDefinition[]> =>
    ipcRenderer.invoke("mcp:list-server-tools", configServerId),
  listMcpProjectServers: (
    projectId: string
  ): Promise<McpProjectServerStatus[]> =>
    ipcRenderer.invoke("mcp:list-project-servers", projectId),
  listMcpProjectServerTools: (
    projectId: string,
    serverId: string
  ): Promise<McpProjectToolStatus[]> =>
    ipcRenderer.invoke("mcp:list-project-server-tools", projectId, serverId),
  setMcpProjectServerEnabled: (
    projectId: string,
    serverId: string,
    enabled: boolean
  ): Promise<void> =>
    ipcRenderer.invoke(
      "mcp:set-project-server-enabled",
      projectId,
      serverId,
      enabled
    ),
  setMcpProjectToolEnabled: (
    projectId: string,
    toolName: string,
    enabled: boolean
  ): Promise<void> =>
    ipcRenderer.invoke(
      "mcp:set-project-tool-enabled",
      projectId,
      toolName,
      enabled
    ),
  registerBrowserCommandHandler: (
    handler: (request: BrowserCommandRequest) => Promise<string>
  ): (() => void) => {
    const listener = (
      _event: IpcRendererEvent,
      request: BrowserCommandRequest
    ): void => {
      if (
        !request ||
        typeof request.commandId !== "string" ||
        typeof request.operation !== "string" ||
        typeof request.argsJson !== "string"
      ) {
        return;
      }

      void handler(request)
        .then((resultJson) => {
          const response: BrowserCommandResponse = {
            commandId: request.commandId,
            resultJson,
          };
          ipcRenderer.send(BROWSER_COMMAND_RESPONSE_CHANNEL, response);
        })
        .catch((error: unknown) => {
          const response: BrowserCommandResponse = {
            commandId: request.commandId,
            error: error instanceof Error ? error.message : String(error),
          };
          ipcRenderer.send(BROWSER_COMMAND_RESPONSE_CHANNEL, response);
        });
    };

    ipcRenderer.on(BROWSER_COMMAND_CHANNEL, listener);
    void ipcRenderer.invoke("browser:renderer-register");
    return () => {
      ipcRenderer.removeListener(BROWSER_COMMAND_CHANNEL, listener);
      void ipcRenderer.invoke("browser:renderer-unregister");
    };
  },
  registerUserQuestionHandler: (
    handler: (request: UserQuestionRequest) => Promise<string>
  ): (() => void) => {
    const listener = (
      _event: IpcRendererEvent,
      request: UserQuestionRequest
    ): void => {
      if (
        !request ||
        typeof request.questionId !== "string" ||
        typeof request.interactionId !== "string" ||
        typeof request.question !== "string" ||
        !Array.isArray(request.options) ||
        request.options.some((option) => typeof option !== "string")
      ) {
        return;
      }

      void handler(request)
        .then((resultJson) => {
          const response: UserQuestionResponse = {
            questionId: request.questionId,
            resultJson,
          };
          ipcRenderer.send(USER_QUESTION_RESPONSE_CHANNEL, response);
        })
        .catch((error: unknown) => {
          const response: UserQuestionResponse = {
            questionId: request.questionId,
            error: error instanceof Error ? error.message : String(error),
          };
          ipcRenderer.send(USER_QUESTION_RESPONSE_CHANNEL, response);
        });
    };

    ipcRenderer.on(USER_QUESTION_CHANNEL, listener);
    return () => {
      ipcRenderer.removeListener(USER_QUESTION_CHANNEL, listener);
    };
  },
  issueSensitiveCommandAuthorization: (command: string): Promise<string> =>
    ipcRenderer.invoke("mcp:authorize-sensitive-command", command),
  callMcpTool: (
    toolFullName: string,
    argsJson: string,
    projectId?: string,
    checkpointIds?: string[],
    checkpointWorkDir?: string,
    sensitiveAuthorizationToken?: string,
    onChunk?: (chunk: BashStreamChunk) => void,
    interactionId?: string,
    subAgentAllowedTools?: string[]
  ): Promise<string> => {
    const streamId = createMcpToolStreamId();
    ensureMcpToolChunkListener();

    if (onChunk) {
      mcpToolChunkCallbacks.set(streamId, onChunk);
    }

    return ipcRenderer
      .invoke(
        "mcp:call-tool",
        toolFullName,
        argsJson,
        projectId,
        checkpointIds,
        checkpointWorkDir,
        sensitiveAuthorizationToken,
        streamId,
        interactionId ?? streamId,
        subAgentAllowedTools
      )
      .finally(() => {
        mcpToolChunkCallbacks.delete(streamId);
      });
  },
  createCheckpoint: (workDir: string): Promise<string> =>
    ipcRenderer.invoke("checkpoint:create", workDir),
  restoreCheckpoint: (checkpointId: string, workDir: string): Promise<void> =>
    ipcRenderer.invoke("checkpoint:restore", checkpointId, workDir),
  deleteCheckpoint: (checkpointId: string): Promise<void> =>
    ipcRenderer.invoke("checkpoint:delete", checkpointId),
  listCheckpointChanges: (
    checkpointId: string,
    workDir: string
  ): Promise<CheckpointFileChange[]> =>
    ipcRenderer.invoke("checkpoint:list-changes", checkpointId, workDir),
  listCheckpointDiffs: (
    checkpointId: string,
    workDir: string
  ): Promise<CheckpointFileDiff[]> =>
    ipcRenderer.invoke("checkpoint:list-diffs", checkpointId, workDir),
  writeLog: (level: string, entry: unknown): Promise<void> =>
    ipcRenderer.invoke("debug:write-log", level, entry),
  sum: (a: number, b: number): Promise<number> =>
    ipcRenderer.invoke("native:sum", a, b),
  showNotification: (options: {
    title: string;
    body: string;
    silent?: boolean;
  }): Promise<void> => ipcRenderer.invoke("notification:show", options),
};

export const ptyApi = {
  ptyCreate: (options: {
    cwd: string;
    cols: number;
    rows: number;
    shellPath?: string;
  }): Promise<string> => ipcRenderer.invoke("pty:create", options),
  ptyWrite: (id: string, data: string): Promise<void> =>
    ipcRenderer.invoke("pty:write", id, data),
  ptyResize: (id: string, cols: number, rows: number): Promise<void> =>
    ipcRenderer.invoke("pty:resize", id, cols, rows),
  ptyKill: (id: string): Promise<void> => ipcRenderer.invoke("pty:kill", id),
  onPtyOutput: (
    callback: (data: { id: string; data: string }) => void
  ): (() => void) => {
    const handler = (
      _event: IpcRendererEvent,
      payload: { id: string; data: string }
    ): void => {
      callback(payload);
    };

    ipcRenderer.on("pty:output", handler);

    return () => {
      ipcRenderer.removeListener("pty:output", handler);
    };
  },
  onPtyExit: (
    callback: (data: { id: string; exitCode: number }) => void
  ): (() => void) => {
    const handler = (
      _event: IpcRendererEvent,
      payload: { id: string; exitCode: number }
    ): void => {
      callback(payload);
    };

    ipcRenderer.on("pty:exit", handler);

    return () => {
      ipcRenderer.removeListener("pty:exit", handler);
    };
  },
};

export const windowApi = {
  minimizeWindow: (): Promise<void> => ipcRenderer.invoke("window:minimize"),
  toggleMaximizeWindow: (): Promise<void> =>
    ipcRenderer.invoke("window:maximize-toggle"),
  closeWindow: (): Promise<void> => ipcRenderer.invoke("window:close"),
  confirmCloseWindow: (): Promise<void> =>
    ipcRenderer.invoke("window:confirm-close"),
  isWindowMaximized: (): Promise<boolean> =>
    ipcRenderer.invoke("window:is-maximized"),
  startWindowDrag: (): Promise<void> => ipcRenderer.invoke("window:start-drag"),
  stopWindowDrag: (): Promise<void> => ipcRenderer.invoke("window:stop-drag"),
  writeImageToClipboard: (dataUrl: string): Promise<void> =>
    ipcRenderer.invoke("clipboard:write-image", dataUrl),
  clearBrowserCache: (): Promise<void> =>
    ipcRenderer.invoke("browser:clear-cache"),
  clearBrowserCookies: (): Promise<void> =>
    ipcRenderer.invoke("browser:clear-cookies"),
  onWindowMaximizeStateChanged: (
    callback: (isMaximized: boolean) => void
  ): (() => void) => {
    const handler = (_event: IpcRendererEvent, isMaximized: boolean): void => {
      callback(isMaximized);
    };

    ipcRenderer.on("window:maximize-state-changed", handler);

    return () => {
      ipcRenderer.removeListener("window:maximize-state-changed", handler);
    };
  },
  onCloseRequested: (callback: () => void): (() => void) => {
    const handler = (_event: IpcRendererEvent): void => {
      callback();
    };

    ipcRenderer.on("window:close-requested", handler);

    return () => {
      ipcRenderer.removeListener("window:close-requested", handler);
    };
  },
};
