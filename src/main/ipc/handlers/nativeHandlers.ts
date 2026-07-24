import { ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import type {
  BashStreamChunk,
  BrowserCommand,
  BrowserCommandResponse,
  CodebaseEmbedProgress,
  NativeBridge,
  UserQuestionCommand,
  UserQuestionResponse,
  AppLogInput,
} from "../../native/types";
import {
  BROWSER_COMMAND_RESPONSE_CHANNEL,
  dispatchBrowserCommand,
  registerBrowserRenderer,
  resolveBrowserCommand,
  unregisterBrowserRenderer,
} from "../browserCommandBroker";
import {
  dispatchUserQuestion,
  resolveUserQuestion,
  USER_QUESTION_RESPONSE_CHANNEL,
} from "../userQuestionBroker";

const MCP_TOOL_CHUNK_CHANNEL = "mcp:call-tool:chunk";

export const registerNativeHandlers = (native: NativeBridge): void => {
  ipcMain.handle("native:engine-info", () => native.engineInfo());
  ipcMain.handle(
    "settings:get-system-setting-value",
    async (_event, settingCode: string) =>
      native.getSystemSettingValue(settingCode)
  );
  ipcMain.handle(
    "settings:set-system-setting",
    async (
      _event,
      settingName: string,
      settingCode: string,
      settingValue: string
    ) => native.setSystemSetting(settingName, settingCode, settingValue)
  );
  ipcMain.handle("settings:get-yolo-mode", () => native.getYoloMode());
  ipcMain.handle("settings:set-yolo-mode", (_event, enabled: boolean) =>
    native.setYoloMode(enabled)
  );
  ipcMain.handle("settings:get-plan-mode", () => native.getPlanMode());
  ipcMain.handle("settings:set-plan-mode", (_event, enabled: boolean) =>
    native.setPlanMode(enabled)
  );
  ipcMain.handle("settings:get-privacy-settings", () =>
    native.getPrivacySettings()
  );
  ipcMain.handle(
    "settings:set-privacy-settings",
    (_event, settings: unknown) => {
      if (!settings || typeof settings !== "object") {
        throw new Error("Privacy settings must be an object");
      }
      return native.setPrivacySettings(settings as never);
    }
  );
  ipcMain.handle("settings:get-theme-settings", () =>
    native.getThemeSettings()
  );
  ipcMain.handle("settings:set-theme-settings", (_event, settings: unknown) => {
    if (!settings || typeof settings !== "object") {
      throw new Error("Theme settings must be an object");
    }
    return native.setThemeSettings(settings as never);
  });
  ipcMain.handle(
    "theme:save-background-image",
    (_event, sourcePath: unknown) => {
      if (typeof sourcePath !== "string" || !sourcePath.trim()) {
        throw new Error("Background image source path is required");
      }
      return native.saveThemeBackgroundImage(sourcePath);
    }
  );
  ipcMain.handle(
    "theme:delete-background-image",
    (_event, imagePath: unknown) => {
      if (typeof imagePath !== "string") {
        throw new Error("Background image path must be a string");
      }
      return native.deleteThemeBackgroundImage(imagePath);
    }
  );
  ipcMain.handle("codebase:get-project-scope", (_event, projectId: unknown) => {
    if (typeof projectId !== "string" || !projectId.trim()) {
      throw new Error("Project id is required");
    }
    return native.getCodebaseProjectScopeSettings(projectId.trim());
  });
  ipcMain.handle(
    "codebase:set-project-enabled",
    (event, projectId: unknown, enabled: unknown) => {
      if (typeof projectId !== "string" || !projectId.trim()) {
        throw new Error("Project id is required");
      }
      if (typeof enabled !== "boolean") {
        throw new Error("Codebase enabled state must be a boolean");
      }
      const normalizedProjectId = projectId.trim();
      return native
        .setCodebaseProjectEnabled(normalizedProjectId, enabled)
        .then(() => {
          if (!event.sender.isDestroyed()) {
            event.sender.send("codebase:scope-changed", {
              projectId: normalizedProjectId,
              key: "enabled",
              enabled,
            });
          }
        });
    }
  );
  ipcMain.handle(
    "codebase:set-project-agent-review",
    (_event, projectId: unknown, enabled: unknown) => {
      if (typeof projectId !== "string" || !projectId.trim()) {
        throw new Error("Project id is required");
      }
      if (typeof enabled !== "boolean") {
        throw new Error("Codebase agent review state must be a boolean");
      }
      return native.setCodebaseProjectAgentReview(projectId.trim(), enabled);
    }
  );
  ipcMain.handle(
    "codebase:set-project-reranking",
    (_event, projectId: unknown, enabled: unknown) => {
      if (typeof projectId !== "string" || !projectId.trim()) {
        throw new Error("Project id is required");
      }
      if (typeof enabled !== "boolean") {
        throw new Error("Codebase reranking state must be a boolean");
      }
      return native.setCodebaseProjectReranking(projectId.trim(), enabled);
    }
  );
  ipcMain.handle(
    "codebase:check-project-gitignore",
    (_event, projectId: unknown) => {
      if (typeof projectId !== "string" || !projectId.trim()) {
        throw new Error("Project id is required");
      }
      return native.checkProjectHasGitignore(projectId.trim());
    }
  );
  ipcMain.handle(
    "codebase:start-embedding",
    async (event, projectId: unknown, sessionId: unknown) => {
      if (typeof projectId !== "string" || !projectId.trim()) {
        throw new Error("Project id is required");
      }
      if (typeof sessionId !== "string" || !sessionId.trim()) {
        throw new Error("Session id is required");
      }
      const normalizedProjectId = projectId.trim();
      const normalizedSessionId = sessionId.trim();
      return native.startCodebaseEmbedding(
        normalizedProjectId,
        normalizedSessionId,
        (progress: CodebaseEmbedProgress) => {
          if (event.sender.isDestroyed()) {
            return;
          }
          event.sender.send("codebase:embed:progress", {
            sessionId: normalizedSessionId,
            projectId: normalizedProjectId,
            progress,
          });
        }
      );
    }
  );
  ipcMain.handle("codebase:pause-embedding", (_event, sessionId: unknown) => {
    if (typeof sessionId !== "string" || !sessionId.trim()) {
      throw new Error("Session id is required");
    }
    return native.pauseCodebaseEmbedding(sessionId.trim());
  });
  ipcMain.handle("codebase:resume-embedding", (_event, sessionId: unknown) => {
    if (typeof sessionId !== "string" || !sessionId.trim()) {
      throw new Error("Session id is required");
    }
    return native.resumeCodebaseEmbedding(sessionId.trim());
  });
  ipcMain.handle("codebase:cancel-embedding", (_event, sessionId: unknown) => {
    if (typeof sessionId !== "string" || !sessionId.trim()) {
      throw new Error("Session id is required");
    }
    return native.cancelCodebaseEmbedding(sessionId.trim());
  });
  ipcMain.handle(
    "codebase:is-embedding-active",
    (_event, projectId: unknown) => {
      if (typeof projectId !== "string" || !projectId.trim()) {
        throw new Error("Project id is required");
      }
      return native.isCodebaseEmbeddingActive(projectId.trim());
    }
  );
  ipcMain.handle("codebase:get-index-stats", (_event, projectId: unknown) => {
    if (typeof projectId !== "string" || !projectId.trim()) {
      throw new Error("Project id is required");
    }
    return native.getCodebaseIndexStats(projectId.trim());
  });
  ipcMain.handle("codebase:clear-index", (_event, projectId: unknown) => {
    if (typeof projectId !== "string" || !projectId.trim()) {
      throw new Error("Project id is required");
    }
    return native.clearCodebaseIndex(projectId.trim());
  });
  ipcMain.handle(
    "codebase:start-watch",
    (event, projectId: unknown, projectPath: unknown) => {
      if (typeof projectId !== "string" || !projectId.trim()) {
        throw new Error("Project id is required");
      }
      if (typeof projectPath !== "string" || !projectPath.trim()) {
        throw new Error("Project path is required");
      }
      const normalizedProjectId = projectId.trim();
      const normalizedProjectPath = projectPath.trim();
      native.startCodebaseWatch(
        normalizedProjectId,
        normalizedProjectPath,
        (changedProjectId: string) => {
          if (event.sender.isDestroyed()) {
            return;
          }
          event.sender.send("codebase:files-changed", changedProjectId);
        }
      );
    }
  );
  ipcMain.handle("codebase:stop-watch", (_event, projectId: unknown) => {
    if (typeof projectId !== "string" || !projectId.trim()) {
      throw new Error("Project id is required");
    }
    return native.stopCodebaseWatch(projectId.trim());
  });
  ipcMain.handle("codebase:sync-changes", async (event, projectId: unknown) => {
    if (typeof projectId !== "string" || !projectId.trim()) {
      throw new Error("Project id is required");
    }
    const normalizedProjectId = projectId.trim();
    return native.syncCodebaseChanges(normalizedProjectId, (progress) => {
      if (event.sender.isDestroyed()) {
        return;
      }
      event.sender.send("codebase:sync:progress", {
        projectId: normalizedProjectId,
        progress,
      });
    });
  });
  ipcMain.handle("codebase:preview-scan", (_event, projectId: unknown) => {
    if (typeof projectId !== "string" || !projectId.trim()) {
      throw new Error("Project id is required");
    }
    return native.previewCodebaseScan(projectId.trim());
  });
  ipcMain.handle(
    "codebase:get-resumable-sessions",
    (_event, projectId: unknown) => {
      if (typeof projectId !== "string" || !projectId.trim()) {
        throw new Error("Project id is required");
      }
      return native.getResumableCodebaseSessions(projectId.trim());
    }
  );
  ipcMain.handle(
    "codebase:discard-resumable-session",
    (_event, sessionId: unknown) => {
      if (typeof sessionId !== "string" || !sessionId.trim()) {
        throw new Error("Session id is required");
      }
      return native.discardResumableCodebaseSession(sessionId.trim());
    }
  );
  ipcMain.handle(
    "permissions:list-tool-approvals",
    (_event, projectId: unknown) => {
      if (typeof projectId !== "string" || !projectId.trim()) {
        throw new Error("Project id is required");
      }
      return native.listToolApprovalProjectApprovedTools(projectId.trim());
    }
  );
  ipcMain.handle(
    "permissions:set-tool-approval",
    (_event, projectId: unknown, toolName: unknown, approved: unknown) => {
      if (typeof projectId !== "string" || !projectId.trim()) {
        throw new Error("Project id is required");
      }
      if (typeof toolName !== "string" || !toolName.trim()) {
        throw new Error("Tool name is required");
      }
      if (typeof approved !== "boolean") {
        throw new Error("Tool approval state must be a boolean");
      }
      return native.setToolApprovalProjectToolApproved(
        projectId.trim(),
        toolName.trim(),
        approved
      );
    }
  );

  ipcMain.handle("native:sum", (_event, a: number, b: number) =>
    native.sum(a, b)
  );
  ipcMain.handle("terminal:detect-terminals", () => native.detectTerminals());

  ipcMain.handle(
    "debug:write-log",
    (_event, level: unknown, entry: unknown) => {
      const logEntry = entry as Record<string, unknown>;
      const input: AppLogInput = {
        level: typeof level === "string" ? level : "INFO",
        module: typeof logEntry?.module === "string" ? logEntry.module : "",
        func: typeof logEntry?.func === "string" ? logEntry.func : "",
        line: typeof logEntry?.line === "number" ? logEntry.line : undefined,
        message: typeof logEntry?.message === "string" ? logEntry.message : "",
        input: typeof logEntry?.input === "string" ? logEntry.input : undefined,
        output:
          typeof logEntry?.output === "string" ? logEntry.output : undefined,
        duration:
          typeof logEntry?.duration === "string"
            ? logEntry.duration
            : undefined,
        context:
          typeof logEntry?.context === "string" ? logEntry.context : undefined,
        error: typeof logEntry?.error === "string" ? logEntry.error : undefined,
        source: "renderer",
      };
      return native.writeAppLog(input);
    }
  );

  ipcMain.handle("mcp:list-tools", () => native.listMcpTools());
  ipcMain.handle("skills:list", (_event, projectId: unknown) => {
    if (
      projectId !== undefined &&
      (typeof projectId !== "string" || !projectId.trim())
    ) {
      throw new Error("Project id must be a non-empty string");
    }

    return native.listAvailableSkills(
      typeof projectId === "string" ? projectId.trim() : undefined
    );
  });
  ipcMain.handle(
    "skills:set-enabled",
    (_event, projectId: unknown, skillId: unknown, enabled: unknown) => {
      if (
        projectId !== undefined &&
        (typeof projectId !== "string" || !projectId.trim())
      ) {
        throw new Error("Project id must be a non-empty string");
      }
      if (typeof skillId !== "string" || !skillId.trim()) {
        throw new Error("Skill id is required");
      }
      if (typeof enabled !== "boolean") {
        throw new Error("Skill enabled state must be a boolean");
      }

      return native.setSkillEnabled(
        typeof projectId === "string" ? projectId.trim() : undefined,
        skillId.trim(),
        enabled
      );
    }
  );
  ipcMain.handle("skills:list-project", (_event, projectId: unknown) => {
    if (typeof projectId !== "string" || !projectId.trim()) {
      throw new Error("Project id is required");
    }
    return native.listProjectSkills(projectId.trim());
  });
  ipcMain.handle(
    "skills:set-project-enabled",
    (_event, projectId: unknown, skillId: unknown, enabled: unknown) => {
      if (typeof projectId !== "string" || !projectId.trim()) {
        throw new Error("Project id is required");
      }
      if (typeof skillId !== "string" || !skillId.trim()) {
        throw new Error("Skill id is required");
      }
      if (typeof enabled !== "boolean") {
        throw new Error("Skill enabled state must be a boolean");
      }
      return native.setProjectSkillEnabled(
        projectId.trim(),
        skillId.trim(),
        enabled
      );
    }
  );
  ipcMain.handle("mcp:list-server-tools", (_event, configServerId: unknown) => {
    if (typeof configServerId !== "string" || !configServerId.trim()) {
      throw new Error("MCP server id is required");
    }

    return native.listMcpServerTools(configServerId.trim());
  });
  ipcMain.handle("mcp:list-project-servers", (_event, projectId: unknown) => {
    if (typeof projectId !== "string" || !projectId.trim()) {
      throw new Error("Project id is required");
    }

    return native.listMcpProjectServers(projectId.trim());
  });
  ipcMain.handle(
    "mcp:list-project-server-tools",
    (_event, projectId: unknown, serverId: unknown) => {
      if (typeof projectId !== "string" || !projectId.trim()) {
        throw new Error("Project id is required");
      }
      if (typeof serverId !== "string" || !serverId.trim()) {
        throw new Error("MCP server id is required");
      }

      return native.listMcpProjectServerTools(
        projectId.trim(),
        serverId.trim()
      );
    }
  );
  ipcMain.handle(
    "mcp:set-project-server-enabled",
    (_event, projectId: unknown, serverId: unknown, enabled: unknown) => {
      if (typeof projectId !== "string" || !projectId.trim()) {
        throw new Error("Project id is required");
      }
      if (typeof serverId !== "string" || !serverId.trim()) {
        throw new Error("MCP server id is required");
      }
      if (typeof enabled !== "boolean") {
        throw new Error("MCP server enabled state must be a boolean");
      }

      return native.setMcpProjectServerEnabled(
        projectId.trim(),
        serverId.trim(),
        enabled
      );
    }
  );
  ipcMain.handle(
    "mcp:set-project-tool-enabled",
    (_event, projectId: unknown, toolName: unknown, enabled: unknown) => {
      if (typeof projectId !== "string" || !projectId.trim()) {
        throw new Error("Project id is required");
      }
      if (typeof toolName !== "string" || !toolName.trim()) {
        throw new Error("MCP tool name is required");
      }
      if (typeof enabled !== "boolean") {
        throw new Error("MCP tool enabled state must be a boolean");
      }

      return native.setMcpProjectToolEnabled(
        projectId.trim(),
        toolName.trim(),
        enabled
      );
    }
  );
  ipcMain.handle("browser:renderer-register", (event) => {
    registerBrowserRenderer(event.sender);
  });
  ipcMain.handle("browser:renderer-unregister", (event) => {
    unregisterBrowserRenderer(event.sender);
  });
  ipcMain.on(
    BROWSER_COMMAND_RESPONSE_CHANNEL,
    (event, response: BrowserCommandResponse) => {
      if (!response || typeof response.commandId !== "string") {
        return;
      }
      resolveBrowserCommand(event.sender, response);
    }
  );
  ipcMain.on(
    USER_QUESTION_RESPONSE_CHANNEL,
    (event, response: UserQuestionResponse) => {
      if (!response || typeof response.questionId !== "string") {
        return;
      }
      resolveUserQuestion(event.sender, response);
    }
  );
  ipcMain.handle(
    "mcp:authorize-sensitive-command",
    async (_event, command: unknown) => {
      if (typeof command !== "string" || !command.trim()) {
        throw new Error("Sensitive command is required");
      }

      const token = randomUUID();
      await native.authorizeSensitiveCommand(command, token);
      return token;
    }
  );
  ipcMain.handle(
    "mcp:call-tool",
    async (
      event,
      toolFullName: unknown,
      argsJson: unknown,
      projectId: unknown,
      checkpointIds: unknown,
      checkpointWorkDir: unknown,
      sensitiveAuthorizationToken: unknown,
      streamId: unknown,
      interactionId: unknown,
      subAgentAllowedTools: unknown
    ) => {
      if (typeof toolFullName !== "string" || !toolFullName.trim()) {
        throw new Error("Tool full name is required");
      }
      if (typeof argsJson !== "string") {
        throw new Error("Arguments JSON string is required");
      }
      if (
        projectId !== undefined &&
        (typeof projectId !== "string" || !projectId.trim())
      ) {
        throw new Error("Project id must be a non-empty string");
      }
      if (
        checkpointIds !== undefined &&
        (!Array.isArray(checkpointIds) ||
          checkpointIds.some((id) => typeof id !== "string" || !id.trim()))
      ) {
        throw new Error("Checkpoint ids must be non-empty strings");
      }
      if (
        checkpointWorkDir !== undefined &&
        (typeof checkpointWorkDir !== "string" || !checkpointWorkDir.trim())
      ) {
        throw new Error("Checkpoint working directory must be a string");
      }
      if (
        sensitiveAuthorizationToken !== undefined &&
        (typeof sensitiveAuthorizationToken !== "string" ||
          !sensitiveAuthorizationToken.trim())
      ) {
        throw new Error(
          "Sensitive command authorization token must be a string"
        );
      }
      if (typeof streamId !== "string" || !streamId.trim()) {
        throw new Error("Tool stream ID is required");
      }
      if (typeof interactionId !== "string" || !interactionId.trim()) {
        throw new Error("Tool interaction ID is required");
      }

      const normalizedStreamId = streamId.trim();
      const normalizedInteractionId = interactionId.trim();
      const normalizedSubAgentAllowedTools =
        Array.isArray(subAgentAllowedTools) &&
        subAgentAllowedTools.every(
          (tool) => typeof tool === "string" && tool.trim()
        )
          ? (subAgentAllowedTools as string[])
          : undefined;
      return native.callMcpTool(
        toolFullName.trim(),
        argsJson,
        (projectId as string | undefined)?.trim(),
        (checkpointIds as string[] | undefined)?.map((id) => id.trim()),
        (checkpointWorkDir as string | undefined)?.trim(),
        (sensitiveAuthorizationToken as string | undefined)?.trim(),
        (chunk: BashStreamChunk) => {
          if (event.sender.isDestroyed()) {
            return;
          }

          event.sender.send(MCP_TOOL_CHUNK_CHANNEL, {
            streamId: normalizedStreamId,
            chunk,
          });
        },
        (command: BrowserCommand) =>
          dispatchBrowserCommand(event.sender, command),
        (question: UserQuestionCommand) =>
          dispatchUserQuestion(event.sender, question, normalizedInteractionId),
        normalizedSubAgentAllowedTools
      );
    }
  );

  ipcMain.handle("checkpoint:create", (_event, workDir: unknown) => {
    if (typeof workDir !== "string" || !workDir.trim()) {
      throw new Error(
        "Working directory path is required to create checkpoint"
      );
    }
    return native.createCheckpoint(workDir);
  });
  ipcMain.handle(
    "checkpoint:restore",
    (_event, checkpointId: unknown, workDir: unknown) => {
      if (typeof checkpointId !== "string" || !checkpointId.trim()) {
        throw new Error("Checkpoint id is required to restore checkpoint");
      }
      if (typeof workDir !== "string" || !workDir.trim()) {
        throw new Error(
          "Working directory path is required to restore checkpoint"
        );
      }
      return native.restoreCheckpoint(checkpointId.trim(), workDir);
    }
  );
  ipcMain.handle("checkpoint:delete", (_event, checkpointId: unknown) => {
    if (typeof checkpointId !== "string" || !checkpointId.trim()) {
      throw new Error("Checkpoint id is required to delete checkpoint");
    }
    return native.deleteCheckpoint(checkpointId.trim());
  });
  ipcMain.handle(
    "checkpoint:list-changes",
    (_event, checkpointId: unknown, workDir: unknown) => {
      if (typeof checkpointId !== "string" || !checkpointId.trim()) {
        throw new Error("Checkpoint id is required to list changes");
      }
      if (typeof workDir !== "string" || !workDir.trim()) {
        throw new Error(
          "Working directory path is required to list checkpoint changes"
        );
      }
      return native.listCheckpointChanges(checkpointId.trim(), workDir);
    }
  );
  ipcMain.handle(
    "checkpoint:list-diffs",
    (_event, checkpointId: unknown, workDir: unknown) => {
      if (typeof checkpointId !== "string" || !checkpointId.trim()) {
        throw new Error("Checkpoint id is required to list diffs");
      }
      if (typeof workDir !== "string" || !workDir.trim()) {
        throw new Error(
          "Working directory path is required to list checkpoint diffs"
        );
      }
      return native.listCheckpointDiffs(checkpointId.trim(), workDir);
    }
  );

  ipcMain.handle(
    "usage:list-records",
    (
      _event,
      conversationId: unknown,
      directoryId: unknown,
      limit: unknown,
      offset: unknown
    ) => {
      const convId =
        typeof conversationId === "string" ? conversationId.trim() : "";
      const dirId = typeof directoryId === "string" ? directoryId.trim() : "";
      const safeLimit = typeof limit === "number" && limit > 0 ? limit : 50;
      const safeOffset = typeof offset === "number" && offset > 0 ? offset : 0;
      return native.listUsageRecords(convId, dirId, safeLimit, safeOffset);
    }
  );

  ipcMain.handle(
    "usage:get-summary",
    (_event, since: unknown, until: unknown) => {
      const sinceStr = typeof since === "string" ? since.trim() : "";
      const untilStr = typeof until === "string" ? until.trim() : "";
      return native.getUsageSummary(sinceStr, untilStr);
    }
  );

  ipcMain.handle(
    "usage:get-daily-breakdown",
    (_event, since: unknown, until: unknown) => {
      const sinceStr = typeof since === "string" ? since.trim() : "";
      const untilStr = typeof until === "string" ? until.trim() : "";
      return native.getUsageDailyBreakdown(sinceStr, untilStr);
    }
  );

  ipcMain.handle(
    "logs:list",
    (
      _event,
      level: unknown,
      module: unknown,
      since: unknown,
      until: unknown,
      limit: unknown,
      offset: unknown
    ) => {
      const levelStr = typeof level === "string" ? level.trim() : "";
      const moduleStr = typeof module === "string" ? module.trim() : "";
      const sinceStr = typeof since === "string" ? since.trim() : "";
      const untilStr = typeof until === "string" ? until.trim() : "";
      const safeLimit = typeof limit === "number" && limit > 0 ? limit : 100;
      const safeOffset = typeof offset === "number" && offset > 0 ? offset : 0;
      return native.listAppLogs(
        levelStr,
        moduleStr,
        sinceStr,
        untilStr,
        safeLimit,
        safeOffset
      );
    }
  );

  ipcMain.handle("logs:clear", () => native.clearAppLogs());
};
