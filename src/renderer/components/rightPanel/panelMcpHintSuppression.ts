const suppressedServerIds = new Set<string>();
const listeners = new Set<() => void>();

export const isPanelMcpHintSuppressed = (serverId: string): boolean =>
  suppressedServerIds.has(serverId);

export const suppressPanelMcpHint = (serverId: string): void => {
  if (suppressedServerIds.has(serverId)) {
    return;
  }
  suppressedServerIds.add(serverId);
  for (const listener of listeners) {
    listener();
  }
};

export const subscribePanelMcpHintSuppression = (
  listener: () => void,
): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
