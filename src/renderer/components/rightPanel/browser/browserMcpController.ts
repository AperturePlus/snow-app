export type BrowserMcpCommandArgs = Record<string, unknown>;

export type BrowserMcpCommandHandler = (
  operation: string,
  args: BrowserMcpCommandArgs
) => Promise<unknown>;

type InstanceWaiter = {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const instances = new Map<string, BrowserMcpCommandHandler>();
const instanceWaiters = new Map<string, Set<InstanceWaiter>>();

const parseCommandArgs = (argsJson: string): BrowserMcpCommandArgs => {
  const value = JSON.parse(argsJson) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Browser command arguments must be a JSON object");
  }
  return value as BrowserMcpCommandArgs;
};

export const createBrowserInstanceId = (): string =>
  `browser-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export const registerBrowserMcpInstance = (
  instanceId: string,
  handler: BrowserMcpCommandHandler
): (() => void) => {
  instances.set(instanceId, handler);
  const waiters = instanceWaiters.get(instanceId);
  if (waiters) {
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve();
    }
    instanceWaiters.delete(instanceId);
  }

  return () => {
    if (instances.get(instanceId) === handler) {
      instances.delete(instanceId);
    }
  };
};

export const waitForBrowserMcpInstance = (
  instanceId: string,
  timeoutMs = 10_000
): Promise<void> => {
  if (instances.has(instanceId)) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      const waiters = instanceWaiters.get(instanceId);
      waiters?.delete(waiter);
      if (waiters?.size === 0) {
        instanceWaiters.delete(instanceId);
      }
      reject(new Error(`Browser instance did not become ready: ${instanceId}`));
    }, timeoutMs);
    const waiter: InstanceWaiter = { resolve, reject, timer };
    const waiters = instanceWaiters.get(instanceId) ?? new Set<InstanceWaiter>();
    waiters.add(waiter);
    instanceWaiters.set(instanceId, waiters);
  });
};

export const executeBrowserMcpCommand = async (
  operation: string,
  argsJson: string
): Promise<string> => {
  const args = parseCommandArgs(argsJson);
  const instanceId =
    typeof args.instanceId === "string" ? args.instanceId.trim() : "";
  if (!instanceId) {
    throw new Error(`instanceId is required for browser ${operation}`);
  }

  const handler = instances.get(instanceId);
  if (!handler) {
    throw new Error(`Browser instance was not found: ${instanceId}`);
  }
  const result = await handler(operation, args);
  return JSON.stringify(result);
};

export const parseBrowserMcpCommandArgs = parseCommandArgs;
