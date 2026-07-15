import { ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import type {
  BashStreamChunk,
  BrowserCommand,
  BrowserCommandResponse,
  NativeBridge,
  UserQuestionCommand,
  UserQuestionResponse,
} from "../../native/types";
import {
  writeLog,
  type LogEntry,
  type LogLevel,
} from "../../../utils/snowLogger";
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
  ipcMain.handle(
    "permissions:list-always-approved-tools",
    async (_event, workspacePath: string | undefined) =>
      native.listAlwaysApprovedTools(workspacePath)
  );
  ipcMain.handle(
    "permissions:add-always-approved-tool",
    async (_event, workspacePath: string | undefined, toolName: string) =>
      native.addAlwaysApprovedTool(workspacePath, toolName)
  );

  ipcMain.handle("native:sum", (_event, a: number, b: number) =>
    native.sum(a, b)
  );
  ipcMain.handle("terminal:detect-terminals", () => native.detectTerminals());

  ipcMain.handle(
    "debug:write-log",
    (_event, level: unknown, entry: unknown) => {
      writeLog(level as LogLevel, entry as LogEntry);
    }
  );

  ipcMain.handle("mcp:list-tools", () => native.listMcpTools());
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
      interactionId: unknown
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
          dispatchUserQuestion(event.sender, question, normalizedInteractionId)
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
};
