import type { McpServerConfigInput } from "../../../../preload";
import type {
  McpKeyValuePair,
  McpServerConfig,
  McpServerDraft,
  McpStringItem,
} from "./types";

const createMcpItemId = (): string =>
  `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const createMcpPair = (key = "", value = ""): McpKeyValuePair => ({
  id: createMcpItemId(),
  key,
  value,
});

export const createMcpStringItem = (value = ""): McpStringItem => ({
  id: createMcpItemId(),
  value,
});

export const EMPTY_MCP_SERVER_DRAFT: McpServerDraft = {
  serverId: "",
  name: "",
  transportType: "stdio",
  url: "",
  command: "",
  args: [],
  env: [],
  headers: [],
  enabled: true,
  timeoutMs: "",
  sortOrder: 0,
  source: "manual",
};

const parseJsonObject = (value: string): Record<string, string> => {
  try {
    const parsed = JSON.parse(value || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return Object.entries(parsed).reduce<Record<string, string>>(
      (result, [key, item]) => {
        if (typeof item === "string") {
          result[key] = item;
        }
        return result;
      },
      {}
    );
  } catch {
    return {};
  }
};

const pairsFromJson = (value: string): McpKeyValuePair[] =>
  Object.entries(parseJsonObject(value)).map(([key, item]) =>
    createMcpPair(key, item)
  );

export const pairsToJson = (pairs: McpKeyValuePair[]): string => {
  const result: Record<string, string> = {};

  pairs.forEach((pair) => {
    const key = pair.key.trim();
    if (key) {
      result[key] = pair.value.trim();
    }
  });

  return JSON.stringify(result);
};

export const argsToJson = (args: McpStringItem[]): string => {
  const values = args.map((item) => item.value.trim()).filter(Boolean);

  return JSON.stringify(values);
};

export const argsFromJson = (value: string): McpStringItem[] => {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed)
      ? parsed
          .filter((item) => typeof item === "string")
          .map((item) => createMcpStringItem(item))
      : [];
  } catch {
    return [];
  }
};

export const hasDuplicatePairKey = (pairs: McpKeyValuePair[]): boolean => {
  const keys = pairs.map((pair) => pair.key.trim()).filter(Boolean);
  return keys.some((key, index) => keys.indexOf(key) !== index);
};

export const toDraft = (server: McpServerConfig): McpServerDraft => ({
  serverId: server.serverId,
  name: server.name,
  transportType: server.transportType,
  url: server.url,
  command: server.command,
  args: argsFromJson(server.argsJson),
  env: pairsFromJson(server.envJson),
  headers: pairsFromJson(server.headersJson),
  enabled: server.enabled,
  timeoutMs: server.timeoutMs ? String(server.timeoutMs) : "",
  sortOrder: server.sortOrder,
  source: server.source,
});

export const toInput = (
  draft: McpServerDraft,
  fallbackSortOrder: number
): McpServerConfigInput => ({
  serverId: draft.serverId || `global:${draft.name.trim()}`,
  name: draft.name.trim(),
  transportType: draft.transportType,
  url: draft.url.trim(),
  command: draft.command.trim(),
  argsJson: argsToJson(draft.args),
  envJson: pairsToJson(draft.env),
  headersJson: pairsToJson(draft.headers),
  enabled: draft.enabled,
  ...(draft.timeoutMs.trim() ? { timeoutMs: Number(draft.timeoutMs) } : {}),
  sortOrder: draft.sortOrder || fallbackSortOrder,
  source: draft.source || "manual",
});

export const getMcpServerEndpoint = (server: McpServerConfig): string =>
  server.transportType === "http" ? server.url : server.command;
