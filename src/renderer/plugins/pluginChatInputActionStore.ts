import type { PluginChatInputActionResult } from "./pluginChatInputAction";

export type SessionActionTask = {
  sessionKey: string;
  conversationId: string | null;
  pluginId: string;
  panelId: string;
  actionName: string;
  controller: AbortController;
  busy: boolean;
  status: string;
  result: PluginChatInputActionResult | null;
  undo?: () => Promise<void>;
  apply?: () => Promise<PluginChatInputActionResult>;
  isAborted: boolean;
  createdAt: number;
  updatedAt: number;
};

const tasks = new Map<string, SessionActionTask>();
const listeners = new Map<string, Set<() => void>>();

const TASK_LIMIT = 64;
const TASK_TTL_MS = 30 * 60 * 1000;

const pruneStaleTasks = (): void => {
  const now = Date.now();
  for (const [key, task] of tasks) {
    if (!task.busy && now - task.updatedAt > TASK_TTL_MS) {
      tasks.delete(key);
    }
  }
  while (tasks.size > TASK_LIMIT) {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [key, task] of tasks) {
      if (!task.busy && task.updatedAt < oldestTime) {
        oldestTime = task.updatedAt;
        oldestKey = key;
      }
    }
    if (!oldestKey) break;
    tasks.delete(oldestKey);
  }
};

export const getSessionActionTask = (
  sessionKey: string,
): SessionActionTask | undefined => {
  if (!sessionKey) return undefined;
  return tasks.get(sessionKey);
};

export const subscribeSessionActionTask = (
  sessionKey: string,
  listener: () => void,
): (() => void) => {
  if (!sessionKey) return () => {};
  let set = listeners.get(sessionKey);
  if (!set) {
    set = new Set();
    listeners.set(sessionKey, set);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
    if (set && set.size === 0) {
      listeners.delete(sessionKey);
    }
  };
};

const notifySessionActionChanged = (sessionKey: string): void => {
  const set = listeners.get(sessionKey);
  if (set) {
    for (const listener of set) {
      listener();
    }
  }
};

export const setSessionActionTask = (
  sessionKey: string,
  update: Partial<SessionActionTask> & { controller?: AbortController },
): SessionActionTask => {
  const existing = tasks.get(sessionKey);
  const next: SessionActionTask = {
    sessionKey,
    conversationId: update.conversationId ?? existing?.conversationId ?? null,
    pluginId: update.pluginId ?? existing?.pluginId ?? "",
    panelId: update.panelId ?? existing?.panelId ?? "",
    actionName: update.actionName ?? existing?.actionName ?? "",
    controller:
      update.controller ?? existing?.controller ?? new AbortController(),
    busy: update.busy ?? existing?.busy ?? false,
    status: update.status ?? existing?.status ?? "",
    result:
      update.result !== undefined ? update.result : (existing?.result ?? null),
    undo: update.undo ?? existing?.undo,
    apply: update.apply ?? existing?.apply,
    isAborted: update.isAborted ?? existing?.isAborted ?? false,
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  };
  const isChanged =
    !existing ||
    existing.busy !== next.busy ||
    existing.status !== next.status ||
    existing.result !== next.result ||
    existing.isAborted !== next.isAborted;
  tasks.set(sessionKey, next);
  pruneStaleTasks();
  if (isChanged) {
    notifySessionActionChanged(sessionKey);
  }
  return next;
};

export const abortSessionActionTask = (sessionKey: string): void => {
  if (!sessionKey) return;
  const task = tasks.get(sessionKey);
  if (task) {
    task.isAborted = true;
    task.controller.abort();
    task.busy = false;
    task.status = "";
    task.updatedAt = Date.now();
    notifySessionActionChanged(sessionKey);
  }
};

export const clearSessionActionTask = (sessionKey: string): void => {
  if (!sessionKey) return;
  const task = tasks.get(sessionKey);
  if (task) {
    task.isAborted = true;
    task.controller.abort();
    tasks.delete(sessionKey);
    notifySessionActionChanged(sessionKey);
  }
};
