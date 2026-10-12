import { ipcMain, type WebContents } from "electron";
import { randomUUID } from "node:crypto";
import { storageReady } from "../../app/storageReady";
import type { NativeBridge } from "../../native/types";
import type {
  PromptCodebaseContextOptions,
  PromptProjectBinding,
  PromptProjectContextStatus,
} from "../../../preload/types/promptOptimization";

export const contextObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid project context request");
  return value as Record<string, unknown>;
};
export const contextString = (
  value: unknown,
  optional = false,
): string | undefined => {
  if (value === undefined && optional) return undefined;
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 1024 ||
    /[\x00-\x1f\x7f-\x9f]/.test(value)
  )
    throw new Error("Invalid project context identifier");
  return value;
};
const fields = (
  value: Record<string, unknown>,
  allowed: readonly string[],
): void => {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error("Unknown project context field");
};
const identifier = (value: unknown, optional = false): string | undefined => {
  const text = contextString(value, optional);
  if (text !== undefined && text.length > 200)
    throw new Error("Invalid project context identifier");
  return text;
};
const privateIdentifier = (value: unknown): string => {
  const text = contextString(value)!;
  if (
    !/^(?:[a-f0-9]{64}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(
      text,
    )
  )
    throw new Error("Invalid private project context identifier");
  return text;
};
export const validateCodebaseOptions = (
  value: unknown,
): PromptCodebaseContextOptions | undefined => {
  if (value === undefined) return undefined;
  const v = contextObject(value);
  fields(v, [
    "mode",
    "budget",
    "planner",
    "rerank",
    "reviewSources",
    "includePaths",
    "excludePaths",
  ]);
  if (
    typeof v.mode !== "string" ||
    typeof v.budget !== "string" ||
    typeof v.planner !== "string"
  )
    throw new Error("Invalid project context options");
  if (
    !["off", "auto", "always"].includes(String(v.mode)) ||
    !["fast", "balanced"].includes(String(v.budget)) ||
    !["local", "model"].includes(String(v.planner)) ||
    typeof v.rerank !== "boolean" ||
    typeof v.reviewSources !== "boolean"
  )
    throw new Error("Invalid project context options");
  const result: PromptCodebaseContextOptions = {
    mode: v.mode as PromptCodebaseContextOptions["mode"],
    budget: v.budget as PromptCodebaseContextOptions["budget"],
    planner: v.planner as PromptCodebaseContextOptions["planner"],
    rerank: v.rerank,
    reviewSources: v.reviewSources,
  };
  for (const key of ["includePaths", "excludePaths"] as const) {
    if (v[key] === undefined) continue;
    if (!Array.isArray(v[key]) || v[key].length > 64)
      throw new Error("Invalid project context paths");
    result[key] = v[key].map((path: unknown) => {
      if (
        typeof path !== "string" ||
        !path ||
        path.length > 512 ||
        /^[\\/]/.test(path) ||
        path.includes(":") ||
        path.includes("\\") ||
        path.split("/").includes("..") ||
        /[\x00-\x1f]/.test(path)
      )
        throw new Error("Project context paths must be relative");
      return path;
    });
  }
  if (
    (result.includePaths?.length ?? 0) + (result.excludePaths?.length ?? 0) >
      64 ||
    JSON.stringify(result).length > 16000
  )
    throw new Error("Project context options exceed budget");
  return result;
};
type Binding = {
  json: string;
  pluginId: string;
  expires: number;
  projectName: string;
  projectId: string;
  statusRevision?: number;
  authorization?: { ticket: string; optionsKey: string; expires: number };
};
export const createPromptContextHost = (
  native: NativeBridge,
  onInvalidate?: (sender: WebContents) => void,
) => {
  const owners = new Map<
    WebContents,
    {
      id: string;
      bindings: Map<string, Binding>;
      sources: Map<string, Binding>;
    }
  >();
  const capability = () =>
    [
      native.getPromptContextStatus,
      native.grantPromptContextAccess,
      native.revokePromptContextAccess,
      native.getPromptContextSourcePreview,
    ].every((f) => typeof f === "function");
  const subscribed = new WeakSet<WebContents>();
  const owner = (sender: WebContents) => {
    let current = owners.get(sender);
    if (!current) {
      current = { id: randomUUID(), bindings: new Map(), sources: new Map() };
      owners.set(sender, current);
      if (!subscribed.has(sender)) {
        subscribed.add(sender);
        const clear = () => {
          owners.delete(sender);
          onInvalidate?.(sender);
        };
        sender.once("destroyed", clear);
        sender.on("did-start-navigation", (_event, _url, inPlace, main) => {
          if (main && !inPlace) clear();
        });
      }
    }
    return current;
  };
  const requirePlugin = async (pluginId: string) => {
    await storageReady;
    const plugin = (await native.listPlugins()).find(
      (p) => p.pluginId === pluginId,
    );
    if (
      !plugin?.enabled ||
      plugin.renderMode !== "esm" ||
      !plugin.privacy.includes("projectContext")
    )
      throw new Error("Project context privacy declaration required");
  };
  const requireBinding = async (sender: WebContents, handle: unknown) => {
    const key = privateIdentifier(handle);
    const value = owners.get(sender)?.bindings.get(key);
    if (!value || value.expires < Date.now())
      throw new Error("Project context binding expired");
    await requirePlugin(value.pluginId);
    if (owners.get(sender)?.bindings.get(key) !== value)
      throw new Error("Project context binding expired");
    return value;
  };
  ipcMain.handle("prompt:context:capabilities", () => capability());
  ipcMain.handle("prompt:context:bind", async (event, value: unknown) => {
    if (!capability()) throw new Error("Project context unavailable");
    const v = contextObject(value);
    fields(v, [
      "pluginId",
      "projectId",
      "sessionKey",
      "conversationId",
      "worktreeId",
      "worktreeMode",
    ]);
    const pluginId = identifier(v.pluginId)!;
    const projectId = identifier(v.projectId)!;
    const sessionKey = identifier(v.sessionKey)!;
    const conversationId = identifier(v.conversationId, true);
    const worktreeId = identifier(v.worktreeId, true);
    if (v.worktreeMode !== undefined && typeof v.worktreeMode !== "boolean")
      throw new Error("Invalid worktree mode");
    const current = owner(event.sender);
    await requirePlugin(pluginId);
    const project = (await native.listWorkspaceDirectories()).find(
      (p) => p.directoryId === projectId,
    );
    if (owners.get(event.sender) !== current || event.sender.isDestroyed())
      throw new Error("Project context expired");
    if (!project) return { projectId, status: "no_project" };
    if (project.kind !== "local")
      return { projectId, status: "remote_project_unsupported" };
    let workspaceRoot = project.path;
    const tree = worktreeId
      ? (await native.gitListWorktrees(projectId)).find(
          (t) => t.worktreeId === worktreeId,
        )
      : conversationId
        ? await native.getConversationWorktree(conversationId)
        : null;
    if (tree) {
      if (!tree.isValid || tree.directoryId !== projectId || !tree.worktreePath)
        return { projectId, status: "worktree_index_unavailable" };
      workspaceRoot = tree.worktreePath;
    } else if (worktreeId || v.worktreeMode === true)
      return { projectId, status: "worktree_index_unavailable" };
    if (owners.get(event.sender) !== current || event.sender.isDestroyed())
      throw new Error("Project context expired");
    const binding: PromptProjectBinding = {
      pluginId,
      projectId,
      sessionKey,
      conversationId,
      workspaceRoot,
      worktreeId: tree?.worktreeId,
    };
    for (const [key, b] of current.bindings)
      if (b.expires < Date.now()) current.bindings.delete(key);
    while (current.bindings.size >= 128)
      current.bindings.delete(current.bindings.keys().next().value!);
    const handle = randomUUID();
    current.bindings.set(handle, {
      json: JSON.stringify({ ...binding, ownerId: current.id }),
      pluginId,
      projectId,
      projectName: project.name,
      expires: Date.now() + 5 * 60 * 1000,
    });
    return handle;
  });
  for (const action of ["status", "grant", "revoke"] as const) {
    ipcMain.handle(
      `prompt:context:${action}`,
      async (event, handle: unknown, options: unknown) => {
        try {
          if (!capability()) throw new Error("Project context unavailable");
          const binding = await requireBinding(event.sender, handle);
          const v = contextObject(options ?? {});
          fields(v, ["apiProfile", "model", "codebaseContext"]);
          const profile = contextString(v.apiProfile, true);
          const model = contextString(v.model, true);
          const opts = validateCodebaseOptions(v.codebaseContext);
          if (action === "revoke") {
            // Consent is plugin/project-scoped, so revoke related owners in every window.
            for (const [sender, current] of owners) {
              if (
                [...current.bindings.values()].some(
                  (value) =>
                    value.pluginId === binding.pluginId &&
                    value.projectId === binding.projectId,
                )
              ) {
                owners.delete(sender);
                onInvalidate?.(sender);
              }
            }
            return await native.revokePromptContextAccess!(
              binding.json,
              profile,
              model,
              opts && JSON.stringify(opts),
            );
          }
          const optionsJson = opts && JSON.stringify(opts);
          const optionsKey = JSON.stringify({ profile, model, opts });
          const revision = (binding.statusRevision ?? 0) + 1;
          binding.statusRevision = revision;
          let response: string;
          if (action === "grant") {
            const authorization = binding.authorization;
            delete binding.authorization;
            if (
              !authorization ||
              authorization.expires <= Date.now() ||
              authorization.optionsKey !== optionsKey
            )
              throw new Error("Authorization confirmation expired or changed");
            response = await native.grantPromptContextAccess!(
              binding.json,
              profile,
              model,
              optionsJson,
              authorization.ticket,
            );
          } else {
            delete binding.authorization;
            response = await native.getPromptContextStatus!(
              binding.json,
              profile,
              model,
              optionsJson,
            );
          }
          if (
            response.length > 16000 ||
            binding.statusRevision !== revision ||
            owners
              .get(event.sender)
              ?.bindings.get(privateIdentifier(handle)) !== binding
          )
            throw new Error("Project context expired");
          const raw = contextObject(JSON.parse(response));
          if (
            typeof raw.authorized !== "boolean" ||
            raw.projectId !== binding.projectId ||
            !Array.isArray(raw.services) ||
            raw.services.length > 8
          )
            throw new Error("Invalid project context status");
          const services = Array.isArray(raw.services)
            ? raw.services.slice(0, 8).map((s) => {
                const item = contextObject(s);
                if (
                  ![
                    "embedding",
                    "optimization",
                    "reranking",
                    "planner",
                  ].includes(String(item.kind))
                )
                  throw new Error("Invalid service");
                return { kind: item.kind, label: contextString(item.label)! };
              })
            : [];
          if (action === "status" && raw.authorizationTicket !== undefined) {
            const ticket = privateIdentifier(raw.authorizationTicket);
            binding.authorization = {
              ticket,
              optionsKey,
              expires: Date.now() + 120000,
            };
          }
          if (action === "grant" && raw.authorized !== true)
            throw new Error("Project context authorization unavailable");
          return {
            bindingHandle: handle,
            projectId: binding.projectId,
            projectName: binding.projectName,
            status: contextString(raw.status)!,
            authorized: raw.authorized === true,
            services,
          } as PromptProjectContextStatus;
        } catch {
          throw new Error("Project context operation unavailable");
        }
      },
    );
  }
  ipcMain.handle("prompt:context:invalidate", (event) => {
    owners.delete(event.sender);
    onInvalidate?.(event.sender);
    return true;
  });
  ipcMain.handle(
    "prompt:context:preview",
    async (event, handle: unknown, sourceId: unknown) => {
      try {
        const current = owners.get(event.sender);
        const key = privateIdentifier(handle);
        const id = privateIdentifier(sourceId);
        const source = current?.sources.get(key);
        if (!current || !source || source.expires < Date.now() || !capability())
          throw new Error("Unavailable");
        await requirePlugin(source.pluginId);
        if (owners.get(event.sender) !== current)
          throw new Error("Unavailable");
        const raw = await native.getPromptContextSourcePreview!(
          key,
          id,
          current.id,
        );
        if (
          owners.get(event.sender) !== current ||
          current.sources.get(key) !== source ||
          raw.length > 100000
        )
          throw new Error("Unavailable");
        const preview = contextObject(JSON.parse(raw));
        if (
          preview.id !== id ||
          typeof preview.content !== "string" ||
          preview.content.length > 64000
        )
          throw new Error("Unavailable");
        return preview.content;
      } catch {
        throw new Error("Project context source unavailable");
      }
    },
  );
  const rememberSources = (
    sender: WebContents,
    handle: string,
    binding: Binding,
  ): void => {
    const current = owners.get(sender);
    if (!current || ![...current.bindings.values()].includes(binding)) return;
    while (current.sources.size >= 128)
      current.sources.delete(current.sources.keys().next().value!);
    current.sources.set(handle, binding);
  };
  const requireSelection = (
    sender: WebContents,
    handle: string,
    binding: Binding,
  ): void => {
    const source = owners.get(sender)?.sources.get(privateIdentifier(handle));
    if (!source || source.expires < Date.now() || source.json !== binding.json)
      throw new Error("Project context source binding expired");
  };
  return { capability, requireBinding, rememberSources, requireSelection };
};
