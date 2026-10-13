export const OPEN_PROJECT_MCP_PANEL_EVENT = "project-mcp:open-panel";

let pendingOpenRequest: string | null = null;

export const requestOpenProjectMcpPanel = (serverId?: string): void => {
  pendingOpenRequest = serverId ?? "";
  window.dispatchEvent(new CustomEvent(OPEN_PROJECT_MCP_PANEL_EVENT));
};

export const consumeProjectMcpPanelRequest = (): string | null => {
  if (pendingOpenRequest === null) {
    return null;
  }
  const serverId = pendingOpenRequest;
  pendingOpenRequest = null;
  return serverId;
};
