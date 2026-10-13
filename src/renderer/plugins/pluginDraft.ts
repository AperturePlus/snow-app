import {
  readEditableContent,
  replaceDraftText,
  splitDraftText,
} from "../components/mainContent/chatInput/fileTagUtils";
import { persistSessionDraft } from "../components/mainContent/chatInput/chatInputDraftBridge";

const revisions = new WeakMap<HTMLElement, number>();
/** Called synchronously for every controller write, even A -> B -> A in one render. */
export const markPluginDraftChanged = (element: HTMLElement | null): void => {
  if (element) revisions.set(element, (revisions.get(element) ?? 0) + 1);
};

type DraftHost = {
  element: HTMLElement;
  projectId: string;
  sessionKey: string;
  conversationId: string | null;
  worktreeId?: string;
  worktreeMode?: boolean;
  restoreContent: (content: string) => void;
};

type DraftToken = {
  pluginId: string;
  host: DraftHost;
  revision: number;
  expected: string;
  original: string;
  expiresAt: number;
  kind: "draft" | "restore";
};

let host: DraftHost | null = null;
let contextRevision = 0;
const contextListeners = new Set<() => void>();
export const getPluginDraftContextRevision = (): number => contextRevision;
export const subscribePluginDraftContext = (
  listener: () => void,
): (() => void) => {
  contextListeners.add(listener);
  return () => {
    contextListeners.delete(listener);
  };
};
const notifyContextChanged = (): void => {
  contextRevision += 1;
  for (const listener of contextListeners) listener();
};
const observers = new WeakMap<DraftHost, MutationObserver>();
const revisionOf = (current: DraftHost): number => {
  // Drain records synchronously so even DOM A -> B -> A within one task is stale.
  if (observers.get(current)?.takeRecords().length) {
    markPluginDraftChanged(current.element);
  }
  return revisions.get(current.element) ?? 0;
};
const tokens = new Map<string, DraftToken>();
const TOKEN_LIMIT = 128;
const TOKEN_TTL_MS = 5 * 60 * 1000;

/** Re-register on project/session changes; streaming or compaction are not draft changes. */
export const registerPluginDraftHost = (next: DraftHost): (() => void) => {
  host = next;
  const now = Date.now();
  for (const [key, token] of tokens) {
    if (token.expiresAt <= now) tokens.delete(key);
  }
  const observer = new MutationObserver((records) => {
    if (records.length) markPluginDraftChanged(next.element);
  });
  observer.observe(next.element, {
    subtree: true,
    childList: true,
    characterData: true,
    // Layout / placeholder attributes are not draft revisions. Controller
    // writes and text/child mutations cover actual editor content changes.
  });
  observers.set(next, observer);
  notifyContextChanged();
  return () => {
    observer.disconnect();
    observers.delete(next);
    if (host === next) {
      host = null;
      notifyContextChanged();
    }
  };
};

const requireHost = (): DraftHost => {
  if (!host || !host.element.isConnected || !host.element.isContentEditable) {
    throw new Error("Chat input is not mounted or available");
  }
  return host;
};

const issue = (value: Omit<DraftToken, "expiresAt">): string => {
  const now = Date.now();
  for (const [key, token] of tokens) {
    if (token.expiresAt <= now) tokens.delete(key);
  }
  while (tokens.size >= TOKEN_LIMIT) tokens.delete(tokens.keys().next().value!);
  const key = crypto.randomUUID();
  tokens.set(key, { ...value, expiresAt: now + TOKEN_TTL_MS });
  return key;
};

const consume = (
  pluginId: string,
  key: unknown,
  kind: DraftToken["kind"],
): DraftToken => {
  if (typeof key !== "string") throw new Error("A draft token is required");
  const token = tokens.get(key);
  // A different plugin cannot consume another plugin's token.
  if (!token || token.pluginId !== pluginId || token.kind !== kind) {
    throw new Error("Draft token is invalid or expired");
  }
  tokens.delete(key);
  if (token.expiresAt <= Date.now()) {
    throw new Error("Draft token is expired");
  }
  return token;
};

export const getPluginProjectBinding = (
  pluginId: string,
  draftToken?: string,
  draft?: string,
): {
  pluginId: string;
  projectId: string;
  sessionKey: string;
  conversationId?: string;
  worktreeId?: string;
  worktreeMode?: boolean;
} | null => {
  if (draftToken !== undefined) {
    const token = tokens.get(draftToken);
    if (
      !token ||
      token.pluginId !== pluginId ||
      token.kind !== "draft" ||
      token.expiresAt <= Date.now()
    ) {
      throw new DOMException(
        "Draft changed or project context expired",
        "AbortError",
      );
    }
    if (draft !== undefined && draft !== splitDraftText(token.original).text)
      throw new Error("Draft does not match captured text");
    return {
      pluginId,
      projectId: token.host.projectId,
      sessionKey: token.host.sessionKey,
      conversationId: token.host.conversationId ?? undefined,
      worktreeId: token.host.worktreeId,
      worktreeMode: token.host.worktreeMode,
    };
  }
  if (draft === undefined && (!host || !host.element.isConnected)) return null;
  let current: DraftHost;
  try {
    current = requireHost();
  } catch {
    throw new DOMException("Draft context unavailable", "AbortError");
  }
  if (draft !== undefined) throw new Error("Captured draft token required");
  if (!current.projectId) return null;
  if (!current.sessionKey)
    throw new DOMException("Draft session unavailable", "AbortError");
  return {
    pluginId,
    projectId: current.projectId,
    sessionKey: current.sessionKey,
    conversationId: current.conversationId ?? undefined,
    worktreeId: current.worktreeId,
    worktreeMode: current.worktreeMode,
  };
};
export const capturePluginDraft = (
  pluginId: string,
): {
  draftToken: string;
  projectId: string;
  inputText: string;
  text: string;
  conversationId: string | null;
} => {
  const current = requireHost();
  const inputText = readEditableContent(current.element);
  const draftToken = issue({
    pluginId,
    host: current,
    revision: revisionOf(current),
    expected: inputText,
    original: inputText,
    kind: "draft",
  });
  return {
    draftToken,
    projectId: current.projectId,
    inputText,
    text: splitDraftText(inputText).text,
    conversationId: current.conversationId,
  };
};

export const applyPluginDraft = (
  pluginId: string,
  draftToken: unknown,
  text: unknown,
): { restoreToken: string } => {
  if (typeof text !== "string") throw new Error("text must be a string");
  const token = consume(pluginId, draftToken, "draft");
  const content = replaceDraftText(token.original, text);
  const current = host;
  const isForeground =
    current &&
    current.element.isConnected &&
    current.sessionKey === token.host.sessionKey;

  if (isForeground) {
    current.restoreContent(content);
  }
  persistSessionDraft(
    token.host.sessionKey,
    token.host.conversationId,
    content,
  );

  const restoreToken = issue({
    pluginId,
    host: isForeground ? current : token.host,
    revision: isForeground ? revisionOf(current) : 0,
    expected: content,
    original: token.original,
    kind: "restore",
  });
  return { restoreToken };
};

export const restorePluginDraft = (
  pluginId: string,
  restoreToken: unknown,
): { restored: true } => {
  const token = consume(pluginId, restoreToken, "restore");
  const current = host;
  const isForeground =
    current &&
    current.element.isConnected &&
    current.sessionKey === token.host.sessionKey;

  if (isForeground) {
    current.restoreContent(token.original);
  }
  persistSessionDraft(
    token.host.sessionKey,
    token.host.conversationId,
    token.original,
  );
  return { restored: true };
};
