export type McpToolDefinition = {
  name: string;
  description: string;
  inputSchemaJson: string;
};
export type BashStreamChunk = {
  stream: "stdout" | "stderr";
  data: string;
};

export type BrowserCommandRequest = {
  commandId: string;
  operation: string;
  argsJson: string;
};

export type BrowserCommandResponse = {
  commandId: string;
  resultJson?: string;
  error?: string;
};

export type McpServerConfigInput = {
  serverId: string;
  scope: string;
  name: string;
  transportType: string;
  url: string;
  command: string;
  argsJson: string;
  envJson: string;
  headersJson: string;
  enabled: boolean;
  timeoutMs?: number;
  sortOrder: number;
  source: string;
};

export type McpServerConfigRecord = Omit<McpServerConfigInput, "timeoutMs"> & {
  id: string;
  timeoutMs: number | null;
  updatedAt: string;
};
