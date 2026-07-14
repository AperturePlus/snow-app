import { ipcMain } from "electron";
import type { NativeBridge } from "../../native/types";
import {
  normalizeSystemPromptItem,
  readSnowCliSystemPromptConfig,
} from "../../settings/systemPromptSettings";
import {
  normalizeCustomHeaderScheme,
  readSnowCliCustomHeadersConfig,
} from "../../settings/customHeadersSettings";
import {
  normalizeMcpServerConfig,
  readSnowCliMcpConfig,
} from "../../settings/mcpSettings";
import {
  normalizeSensitiveCommandConfig,
  readSnowCliSensitiveCommandConfig,
} from "../../settings/sensitiveCommandSettings";

export const registerConfigHandlers = (native: NativeBridge): void => {
  // ===== System Prompts =====
  ipcMain.handle("system-prompts:list", () => native.listSystemPrompts());
  ipcMain.handle("system-prompts:upsert", async (_event, item: unknown) => {
    await native.upsertSystemPrompt(normalizeSystemPromptItem(item));
    return native.listSystemPrompts();
  });
  ipcMain.handle("system-prompts:delete", async (_event, promptId: unknown) => {
    if (typeof promptId !== "string" || !promptId.trim()) {
      throw new Error("Prompt ID is required");
    }
    await native.deleteSystemPrompt(promptId.trim());
    return native.listSystemPrompts();
  });
  ipcMain.handle("system-prompts:import-snow-cli", () =>
    readSnowCliSystemPromptConfig(native)
  );

  // ===== Custom Header Schemes =====
  ipcMain.handle("custom-header-schemes:list", () =>
    native.listCustomHeaderSchemes()
  );
  ipcMain.handle(
    "custom-header-schemes:upsert",
    async (_event, item: unknown) => {
      await native.upsertCustomHeaderScheme(normalizeCustomHeaderScheme(item));
      return native.listCustomHeaderSchemes();
    }
  );
  ipcMain.handle(
    "custom-header-schemes:delete",
    async (_event, schemeId: unknown) => {
      if (typeof schemeId !== "string" || !schemeId.trim()) {
        throw new Error("Custom header scheme ID is required");
      }
      await native.deleteCustomHeaderScheme(schemeId.trim());
      return native.listCustomHeaderSchemes();
    }
  );
  ipcMain.handle("custom-header-schemes:import-snow-cli", () =>
    readSnowCliCustomHeadersConfig(native)
  );

  // ===== MCP Server Configs =====
  ipcMain.handle("mcp-server-configs:list", () =>
    native.listMcpServerConfigs()
  );
  ipcMain.handle("mcp-server-configs:upsert", async (_event, item: unknown) => {
    await native.upsertMcpServerConfig(normalizeMcpServerConfig(item));
    return native.listMcpServerConfigs();
  });
  ipcMain.handle(
    "mcp-server-configs:delete",
    async (_event, serverId: unknown) => {
      if (typeof serverId !== "string" || !serverId.trim()) {
        throw new Error("MCP server ID is required");
      }
      await native.deleteMcpServerConfig(serverId.trim());
      return native.listMcpServerConfigs();
    }
  );
  ipcMain.handle("mcp-server-configs:import-snow-cli", () =>
    readSnowCliMcpConfig(native)
  );

  // ===== Sensitive Command Configs =====
  ipcMain.handle("sensitive-command-configs:list", () =>
    native.listSensitiveCommandConfigs()
  );
  ipcMain.handle(
    "sensitive-command-configs:upsert",
    async (_event, item: unknown) => {
      await native.upsertSensitiveCommandConfig(
        normalizeSensitiveCommandConfig(item)
      );
      return native.listSensitiveCommandConfigs();
    }
  );
  ipcMain.handle(
    "sensitive-command-configs:delete",
    async (_event, commandId: unknown, scope: unknown) => {
      if (typeof commandId !== "string" || !commandId.trim()) {
        throw new Error("Sensitive command ID is required");
      }

      const normalizedScope = scope === "project" ? "project" : "global";
      await native.deleteSensitiveCommandConfig(
        commandId.trim(),
        normalizedScope
      );
      return native.listSensitiveCommandConfigs();
    }
  );
  ipcMain.handle("sensitive-command-configs:import-snow-cli", () =>
    readSnowCliSensitiveCommandConfig(native)
  );

  ipcMain.handle(
    "sensitive-command-configs:check-match",
    async (_event, command: unknown) => {
      if (typeof command !== "string" || !command.trim()) {
        return [];
      }
      return native.checkSensitiveCommandMatch(command);
    }
  );
};
