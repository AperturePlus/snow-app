import { basename } from "node:path";
import type {
  WorkspaceDirectoryInput,
  WorkspaceDirectoryKind,
} from "../native/types";
import { isRecord, toBoolean, toIntegerOrNull, toText } from "../utils/value";

const WORKSPACE_SOURCE_MANUAL = "manual";
const WORKSPACE_KIND_LOCAL = "local";
const WORKSPACE_KIND_SSH = "ssh";

const normalizeKind = (value: unknown): WorkspaceDirectoryKind =>
  value === WORKSPACE_KIND_SSH ? WORKSPACE_KIND_SSH : WORKSPACE_KIND_LOCAL;

const toDirectoryId = (kind: WorkspaceDirectoryKind, path: string): string => {
  const normalizedKind = normalizeKind(kind);
  return `${normalizedKind}:${path.trim()}`;
};

const toDisplayName = (kind: WorkspaceDirectoryKind, path: string): string => {
  const trimmedPath = path.trim();

  if (kind === WORKSPACE_KIND_SSH) {
    return trimmedPath.replace(/^ssh:\/\//, "") || trimmedPath;
  }

  return basename(trimmedPath) || trimmedPath;
};

export const createWorkspaceDirectoryInput = (
  path: string,
  kind: string,
  existingCount: number,
  name?: string
): WorkspaceDirectoryInput => {
  const normalizedKind = normalizeKind(kind);
  const trimmedPath = path.trim();

  if (!trimmedPath) {
    throw new Error("Workspace directory path is required");
  }

  if (
    normalizedKind === WORKSPACE_KIND_SSH &&
    !trimmedPath.startsWith("ssh://")
  ) {
    throw new Error("SSH workspace directory must start with ssh://");
  }

  return {
    directoryId: toDirectoryId(normalizedKind, trimmedPath),
    name: name?.trim() || toDisplayName(normalizedKind, trimmedPath),
    path: trimmedPath,
    kind: normalizedKind,
    isActive: true,
    sortOrder: existingCount,
    source: WORKSPACE_SOURCE_MANUAL,
  };
};

export const normalizeWorkspaceDirectory = (
  value: unknown,
  existingCount: number
): WorkspaceDirectoryInput => {
  if (!isRecord(value)) {
    throw new Error("Workspace directory must be an object");
  }

  const kind = normalizeKind(value.kind);
  const path = toText(value.path).trim();
  const directoryId =
    toText(value.directoryId).trim() || toDirectoryId(kind, path);
  const sortOrder = toIntegerOrNull(value.sortOrder);

  return {
    directoryId,
    name: toText(value.name).trim() || toDisplayName(kind, path),
    path,
    kind,
    isActive: toBoolean(value.isActive, true),
    sortOrder: sortOrder ?? existingCount,
    source: toText(value.source).trim() || WORKSPACE_SOURCE_MANUAL,
  };
};

export const normalizeWorkspaceDirectoryList = (
  value: unknown,
  existingCount: number
): WorkspaceDirectoryInput[] => {
  if (!Array.isArray(value)) {
    throw new Error("Workspace directories must be an array");
  }

  return value.map((item, index) =>
    normalizeWorkspaceDirectory(item, existingCount + index)
  );
};
