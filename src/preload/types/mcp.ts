export type McpToolDefinition = {
  name: string;
  description: string;
  inputSchemaJson: string;
};

export type SkillDefinition = {
  id: string;
  name: string;
  description: string;
  location: "project" | "global";
  source: "snow" | "agents";
  path: string;
  allowedTools?: string[];
  enabled: boolean;
};

export type ProjectSkillDefinition = Omit<SkillDefinition, "enabled"> & {
  defaultEnabled: boolean;
  enabled: boolean;
};

export type McpProjectToolStatus = McpToolDefinition & {
  enabled: boolean;
};

export type McpProjectServerStatus = {
  id: string;
  name: string;
  source: "system" | "external" | "project";
  globalEnabled: boolean;
  enabled: boolean;
  tools: McpProjectToolStatus[];
  error?: string;
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

export type UserQuestionRequest = {
  questionId: string;
  interactionId: string;
  question: string;
  options: string[];
};

export type UserQuestionResponse = {
  questionId: string;
  resultJson?: string;
  error?: string;
};

export type McpServerConfigInput = {
  serverId: string;
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

export type ProjectMcpServerConfigRecord = Omit<
  McpServerConfigInput,
  "timeoutMs"
> & {
  timeoutMs: number | null;
  updatedAt: string;
};
