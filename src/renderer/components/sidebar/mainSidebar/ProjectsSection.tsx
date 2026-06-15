import {
  Check,
  Folder,
  FolderOpen,
  GripVertical,
  Loader2,
  Plus,
  Server,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useI18n } from "../../../i18n";
import type {
  WorkspaceDirectoryInput,
  WorkspaceDirectoryKind,
  WorkspaceDirectoryPage,
  WorkspaceDirectoryRecord,
} from "../../../../preload";

type AddDirectoryMode = "" | WorkspaceDirectoryKind;

type ProjectsSectionProps = {
  onSwitchingDirectoryChange: (isSwitchingDirectory: boolean) => void;
};

type DirectoryDropIntent = "merge" | "sort-before" | "sort-after";

type DirectoryDropTarget = {
  directoryId: string;
  intent: DirectoryDropIntent;
};

type WorkspaceDirectoryListEntry =
  | {
      type: "directory";
      directory: WorkspaceDirectoryRecord;
    }
  | {
      type: "workspace";
      workspaceId: string;
      workspaceName: string;
      directories: WorkspaceDirectoryRecord[];
    };

const WORKSPACE_DIRECTORY_PAGE_SIZE = 30;

const createDirectoryId = (
  kind: WorkspaceDirectoryKind,
  path: string
): string => `${kind}:${path.trim()}`;

const getDirectoryName = (
  kind: WorkspaceDirectoryKind,
  path: string
): string => {
  const trimmedPath = path.trim();

  if (kind === "ssh") {
    return trimmedPath.replace(/^ssh:\/\//, "") || trimmedPath;
  }

  return trimmedPath.split(/[\\/]/).filter(Boolean).pop() || trimmedPath;
};

const toWorkspaceDirectoryInput = (
  path: string,
  kind: WorkspaceDirectoryKind,
  existingCount: number
): WorkspaceDirectoryInput => {
  const trimmedPath = path.trim();

  return {
    directoryId: createDirectoryId(kind, trimmedPath),
    name: getDirectoryName(kind, trimmedPath),
    path: trimmedPath,
    kind,
    workspaceId: "",
    workspaceName: "",
    isActive: true,
    sortOrder: existingCount,
    source: "manual",
  };
};

export function ProjectsSection({
  onSwitchingDirectoryChange,
}: ProjectsSectionProps): React.JSX.Element {
  const { t } = useI18n();
  const [workspaceDirectories, setWorkspaceDirectories] = useState<
    WorkspaceDirectoryRecord[]
  >([]);
  const [workspaceDirectoryTotal, setWorkspaceDirectoryTotal] = useState(0);
  const [isLoadingDirectories, setIsLoadingDirectories] = useState(true);
  const [isLoadingMoreDirectories, setIsLoadingMoreDirectories] =
    useState(false);
  const [isSavingDirectory, setIsSavingDirectory] = useState(false);
  const [isSwitchingDirectory, setIsSwitchingDirectory] = useState(false);
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [addDirectoryMode, setAddDirectoryMode] =
    useState<AddDirectoryMode>("");
  const [sshDirectoryPath, setSshDirectoryPath] = useState("");
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [draggedDirectoryId, setDraggedDirectoryId] = useState<string | null>(
    null
  );
  const [directoryDropTarget, setDirectoryDropTarget] =
    useState<DirectoryDropTarget | null>(null);
  const addMenuRef = useRef<HTMLDivElement | null>(null);
  const sshFormRef = useRef<HTMLDivElement | null>(null);
  const directoryListRef = useRef<HTMLDivElement | null>(null);
  const didDropOnDirectoryRef = useRef(false);

  const hasMoreDirectories =
    workspaceDirectories.length < workspaceDirectoryTotal;

  const activeDirectory = useMemo(
    () => workspaceDirectories.find((directory) => directory.isActive),
    [workspaceDirectories]
  );

  const workspaceDirectoryListEntries = useMemo<
    WorkspaceDirectoryListEntry[]
  >(() => {
    const renderedWorkspaceIds = new Set<string>();

    return workspaceDirectories.reduce<WorkspaceDirectoryListEntry[]>(
      (entries, directory) => {
        if (!directory.workspaceId) {
          entries.push({ type: "directory", directory });
          return entries;
        }

        if (renderedWorkspaceIds.has(directory.workspaceId)) {
          return entries;
        }

        renderedWorkspaceIds.add(directory.workspaceId);
        const directories = workspaceDirectories.filter(
          (item) => item.workspaceId === directory.workspaceId
        );

        entries.push({
          type: "workspace",
          workspaceId: directory.workspaceId,
          workspaceName: directory.workspaceName || directory.name,
          directories,
        });
        return entries;
      },
      []
    );
  }, [workspaceDirectories]);

  const applyWorkspaceDirectoryPage = useCallback(
    (page: WorkspaceDirectoryPage, shouldAppend: boolean): void => {
      setWorkspaceDirectoryTotal(page.total);
      setWorkspaceDirectories((currentDirectories) => {
        if (!shouldAppend) {
          return page.items;
        }

        const existingIds = new Set(
          currentDirectories.map((directory) => directory.directoryId)
        );
        return [
          ...currentDirectories,
          ...page.items.filter(
            (directory) => !existingIds.has(directory.directoryId)
          ),
        ];
      });
    },
    []
  );

  const updateSwitchingDirectory = (nextIsSwitching: boolean): void => {
    setIsSwitchingDirectory(nextIsSwitching);
    onSwitchingDirectoryChange(nextIsSwitching);
  };

  const loadWorkspaceDirectories = useCallback(
    async (offset = 0): Promise<void> => {
      const shouldAppend = offset > 0;
      setDirectoryError(null);

      if (shouldAppend) {
        setIsLoadingMoreDirectories(true);
      } else {
        setIsLoadingDirectories(true);
      }

      try {
        const page = await window.snow.listWorkspaceDirectoriesPage(
          offset,
          WORKSPACE_DIRECTORY_PAGE_SIZE
        );
        applyWorkspaceDirectoryPage(page, shouldAppend);
      } catch (error) {
        setDirectoryError(
          error instanceof Error
            ? error.message
            : t("sidebar.loadDirectoriesError", {
                defaultValue: "Failed to load workspace directories",
              })
        );
      } finally {
        if (shouldAppend) {
          setIsLoadingMoreDirectories(false);
        } else {
          setIsLoadingDirectories(false);
        }
      }
    },
    [applyWorkspaceDirectoryPage, t]
  );

  useEffect(() => {
    void loadWorkspaceDirectories();
  }, [loadWorkspaceDirectories]);

  useEffect(() => {
    if (!isAddMenuOpen && addDirectoryMode !== "ssh") {
      return;
    }

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target;

      if (
        target instanceof Node &&
        (addMenuRef.current?.contains(target) ||
          sshFormRef.current?.contains(target))
      ) {
        return;
      }

      setIsAddMenuOpen(false);
      setAddDirectoryMode("");
      setSshDirectoryPath("");
      setDirectoryError(null);
    };

    window.addEventListener("pointerdown", handlePointerDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [addDirectoryMode, isAddMenuOpen]);

  const persistWorkspaceDirectory = async (
    item: WorkspaceDirectoryInput
  ): Promise<void> => {
    setIsSavingDirectory(true);
    setDirectoryError(null);

    try {
      const page = await window.snow.upsertWorkspaceDirectory(item);
      applyWorkspaceDirectoryPage(page, false);
      setIsAddMenuOpen(false);
      setAddDirectoryMode("");
      setSshDirectoryPath("");
    } catch (error) {
      setDirectoryError(
        error instanceof Error
          ? error.message
          : t("sidebar.addDirectoryError", {
              defaultValue: "Failed to add workspace directory",
            })
      );
    } finally {
      setIsSavingDirectory(false);
    }
  };

  const handleAddDirectoryModeSelect = async (
    mode: WorkspaceDirectoryKind
  ): Promise<void> => {
    setAddDirectoryMode(mode);
    setDirectoryError(null);
    setIsAddMenuOpen(false);

    if (mode === "ssh") {
      return;
    }

    setIsSavingDirectory(true);

    try {
      const selectedPath = await window.snow.selectWorkspaceDirectory(
        t("sidebar.selectLocalDirectoryTitle", {
          defaultValue: "Select local workspace directory",
        })
      );

      if (selectedPath) {
        await persistWorkspaceDirectory(
          toWorkspaceDirectoryInput(
            selectedPath,
            "local",
            workspaceDirectoryTotal
          )
        );
      } else {
        setAddDirectoryMode("");
      }
    } catch (error) {
      setDirectoryError(
        error instanceof Error
          ? error.message
          : t("sidebar.selectLocalDirectoryError", {
              defaultValue: "Failed to select local directory",
            })
      );
    } finally {
      setIsSavingDirectory(false);
    }
  };

  const handleAddSshDirectory = async (): Promise<void> => {
    const trimmedPath = sshDirectoryPath.trim();

    if (!trimmedPath.startsWith("ssh://")) {
      setDirectoryError(
        t("sidebar.sshDirectoryInvalid", {
          defaultValue: "SSH directory must start with ssh://",
        })
      );
      return;
    }

    await persistWorkspaceDirectory(
      toWorkspaceDirectoryInput(trimmedPath, "ssh", workspaceDirectoryTotal)
    );
  };

  const handleCancelSshDirectory = (): void => {
    setIsAddMenuOpen(false);
    setAddDirectoryMode("");
    setSshDirectoryPath("");
    setDirectoryError(null);
  };

  const handleActivateDirectory = async (
    directoryId: string
  ): Promise<void> => {
    if (!directoryId || directoryId === activeDirectory?.directoryId) {
      return;
    }

    updateSwitchingDirectory(true);
    setDirectoryError(null);

    try {
      const page = await window.snow.activateWorkspaceDirectory(directoryId);
      applyWorkspaceDirectoryPage(page, false);
    } catch (error) {
      setDirectoryError(
        error instanceof Error
          ? error.message
          : t("sidebar.activateDirectoryError", {
              defaultValue: "Failed to activate workspace directory",
            })
      );
    } finally {
      updateSwitchingDirectory(false);
    }
  };

  const handleWorkspaceDirectoryScroll = (): void => {
    const listElement = directoryListRef.current;

    if (
      !listElement ||
      !hasMoreDirectories ||
      isLoadingDirectories ||
      isLoadingMoreDirectories
    ) {
      return;
    }

    const remainingScroll =
      listElement.scrollHeight -
      listElement.scrollTop -
      listElement.clientHeight;

    if (remainingScroll < 48) {
      void loadWorkspaceDirectories(workspaceDirectories.length);
    }
  };

  const getDirectoryDropIntent = (
    event: React.DragEvent<HTMLButtonElement>
  ): DirectoryDropIntent => {
    const targetRect = event.currentTarget.getBoundingClientRect();
    const pointerRatio =
      (event.clientY - targetRect.top) / Math.max(targetRect.height, 1);

    if (pointerRatio < 0.28) {
      return "sort-before";
    }

    if (pointerRatio > 0.72) {
      return "sort-after";
    }

    return "merge";
  };

  const handleDragStart = (
    event: React.DragEvent<HTMLButtonElement>,
    directoryId: string
  ): void => {
    didDropOnDirectoryRef.current = false;
    setDraggedDirectoryId(directoryId);
    setDirectoryDropTarget(null);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", directoryId);
  };

  const handleDragOver = (
    event: React.DragEvent<HTMLButtonElement>,
    directoryId: string
  ): void => {
    if (!draggedDirectoryId || draggedDirectoryId === directoryId) {
      setDirectoryDropTarget(null);
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDirectoryDropTarget({
      directoryId,
      intent: getDirectoryDropIntent(event),
    });
  };

  const handleDragEnd = async (): Promise<void> => {
    const sourceDirectoryId = draggedDirectoryId;
    const sourceDirectory = workspaceDirectories.find(
      (directory) => directory.directoryId === sourceDirectoryId
    );
    const shouldSplitFromWorkspace =
      Boolean(sourceDirectory?.workspaceId) && !didDropOnDirectoryRef.current;

    setDraggedDirectoryId(null);
    setDirectoryDropTarget(null);
    didDropOnDirectoryRef.current = false;

    if (!sourceDirectoryId || !shouldSplitFromWorkspace) {
      return;
    }

    setIsSavingDirectory(true);
    setDirectoryError(null);

    try {
      const page = await window.snow.splitWorkspaceDirectory(sourceDirectoryId);
      applyWorkspaceDirectoryPage(page, false);
    } catch (error) {
      setDirectoryError(
        error instanceof Error
          ? error.message
          : t("sidebar.splitDirectoryError", {
              defaultValue: "Failed to split workspace directory",
            })
      );
      await loadWorkspaceDirectories();
    } finally {
      setIsSavingDirectory(false);
    }
  };

  const handleDrop = async (
    event: React.DragEvent<HTMLButtonElement>,
    targetDirectoryId: string
  ): Promise<void> => {
    event.preventDefault();
    didDropOnDirectoryRef.current = true;
    const sourceDirectoryId =
      event.dataTransfer.getData("text/plain") || draggedDirectoryId;
    const dropIntent =
      directoryDropTarget?.directoryId === targetDirectoryId
        ? directoryDropTarget.intent
        : getDirectoryDropIntent(event);

    setDraggedDirectoryId(null);
    setDirectoryDropTarget(null);

    if (!sourceDirectoryId || sourceDirectoryId === targetDirectoryId) {
      return;
    }

    setIsSavingDirectory(true);
    setDirectoryError(null);

    try {
      if (dropIntent === "merge") {
        const page = await window.snow.mergeWorkspaceDirectories(
          sourceDirectoryId,
          targetDirectoryId
        );
        applyWorkspaceDirectoryPage(page, false);
        return;
      }

      const sourceIndex = workspaceDirectories.findIndex(
        (directory) => directory.directoryId === sourceDirectoryId
      );
      const targetIndex = workspaceDirectories.findIndex(
        (directory) => directory.directoryId === targetDirectoryId
      );

      if (sourceIndex < 0 || targetIndex < 0) {
        return;
      }

      const nextDirectories = [...workspaceDirectories];
      const [sourceDirectory] = nextDirectories.splice(sourceIndex, 1);
      const nextTargetIndex = nextDirectories.findIndex(
        (directory) => directory.directoryId === targetDirectoryId
      );

      if (nextTargetIndex < 0) {
        return;
      }

      nextDirectories.splice(
        dropIntent === "sort-before" ? nextTargetIndex : nextTargetIndex + 1,
        0,
        sourceDirectory
      );
      setWorkspaceDirectories(nextDirectories);

      if (sourceDirectory.workspaceId) {
        await window.snow.splitWorkspaceDirectory(sourceDirectoryId);
      }

      const page = await window.snow.reorderWorkspaceDirectories(
        nextDirectories.map((directory) => directory.directoryId)
      );
      applyWorkspaceDirectoryPage(page, false);
    } catch (error) {
      setDirectoryError(
        error instanceof Error
          ? error.message
          : t("sidebar.reorderDirectoryError", {
              defaultValue: "Failed to update workspace directories",
            })
      );
      await loadWorkspaceDirectories();
    } finally {
      setIsSavingDirectory(false);
    }
  };

  return (
    <div className="sidebar-section">
      <div className="section-header">
        <span className="section-title">
          {t("sidebar.projects", { defaultValue: "Projects" })}
        </span>
        <div
          className="section-actions workspace-directory-actions"
          ref={addMenuRef}
        >
          {isLoadingDirectories || isSavingDirectory ? (
            <Loader2 className="spin" size={14} />
          ) : (
            <button
              aria-expanded={isAddMenuOpen}
              aria-label={t("sidebar.addDirectoryScheme", {
                defaultValue: "Add directory",
              })}
              className="icon-btn ghost"
              onClick={() => {
                setDirectoryError(null);
                setAddDirectoryMode("");
                setIsAddMenuOpen((open) => !open);
              }}
              type="button"
            >
              <Plus size={14} />
            </button>
          )}
          {isAddMenuOpen ? (
            <div className="workspace-directory-add-menu">
              <button
                onClick={() => void handleAddDirectoryModeSelect("local")}
                type="button"
              >
                <Folder size={13} />
                <span>
                  {t("sidebar.addLocalDirectory", {
                    defaultValue: "Add local directory",
                  })}
                </span>
              </button>
              <button
                onClick={() => void handleAddDirectoryModeSelect("ssh")}
                type="button"
              >
                <Server size={13} />
                <span>
                  {t("sidebar.addSshDirectory", {
                    defaultValue: "Add SSH directory",
                  })}
                </span>
              </button>
            </div>
          ) : null}
        </div>
      </div>
      <div className="workspace-directory-card">
        <span className="workspace-directory-label">
          {t("sidebar.activeDirectory", {
            defaultValue: "Active directory",
          })}
          {workspaceDirectoryTotal > 0 ? ` · ${workspaceDirectoryTotal}` : ""}
        </span>
        <div
          className="section-list workspace-directory-list"
          onScroll={handleWorkspaceDirectoryScroll}
          ref={directoryListRef}
        >
          {isLoadingDirectories ? (
            <span className="empty-text">
              {t("sidebar.loadingDirectories", {
                defaultValue: "Loading directories...",
              })}
            </span>
          ) : workspaceDirectories.length === 0 ? (
            <span className="empty-text">
              {t("sidebar.noDirectories", {
                defaultValue: "No directories",
              })}
            </span>
          ) : (
            workspaceDirectoryListEntries.map((entry) => {
              if (entry.type === "workspace") {
                return (
                  <div
                    className="workspace-directory-group"
                    key={entry.workspaceId}
                  >
                    <div className="workspace-directory-group-header">
                      <span className="workspace-directory-group-title">
                        {entry.workspaceName}
                      </span>
                      <span className="workspace-directory-group-count">
                        {t("sidebar.workspaceDirectoryCount", {
                          values: { count: entry.directories.length },
                          defaultValue: "{{count}} dirs",
                        })}
                      </span>
                    </div>
                    <div className="workspace-directory-group-items">
                      {entry.directories.map((directory) => {
                        const dropIntent =
                          directoryDropTarget?.directoryId ===
                          directory.directoryId
                            ? directoryDropTarget.intent
                            : null;

                        return (
                          <button
                            className={`list-item workspace-directory-item grouped${
                              directory.isActive ? " active" : ""
                            }${dropIntent === "merge" ? " merge-target" : ""}${
                              dropIntent === "sort-before" ? " sort-before" : ""
                            }${
                              dropIntent === "sort-after" ? " sort-after" : ""
                            }${
                              draggedDirectoryId === directory.directoryId
                                ? " dragging"
                                : ""
                            }`}
                            disabled={isSavingDirectory || isSwitchingDirectory}
                            draggable={
                              !isSavingDirectory && !isSwitchingDirectory
                            }
                            key={directory.directoryId}
                            onClick={() =>
                              void handleActivateDirectory(
                                directory.directoryId
                              )
                            }
                            onDragEnd={() => void handleDragEnd()}
                            onDragOver={(event) =>
                              handleDragOver(event, directory.directoryId)
                            }
                            onDragStart={(event) =>
                              handleDragStart(event, directory.directoryId)
                            }
                            onDrop={(event) =>
                              void handleDrop(event, directory.directoryId)
                            }
                            title={`${directory.path}\n${t(
                              "sidebar.workspaceGroup",
                              { defaultValue: "Workspace" }
                            )}: ${entry.workspaceName}`}
                            type="button"
                          >
                            <GripVertical
                              className="workspace-directory-drag-icon"
                              size={13}
                            />
                            {directory.isActive ? (
                              <FolderOpen className="list-icon" size={15} />
                            ) : directory.kind === "ssh" ? (
                              <Server className="list-icon" size={15} />
                            ) : (
                              <Folder className="list-icon" size={15} />
                            )}
                            <span className="workspace-directory-content">
                              <span className="list-label">
                                {directory.name}
                              </span>
                              <span className="workspace-directory-group-label">
                                {t("sidebar.dragOutToSplit", {
                                  defaultValue: "Drag out to split",
                                })}
                              </span>
                            </span>
                            {dropIntent === "merge" ? (
                              <span className="workspace-directory-merge-icon">
                                <Plus size={12} />
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              }

              const { directory } = entry;
              const dropIntent =
                directoryDropTarget?.directoryId === directory.directoryId
                  ? directoryDropTarget.intent
                  : null;

              return (
                <button
                  className={`list-item workspace-directory-item${
                    directory.isActive ? " active" : ""
                  }${dropIntent === "merge" ? " merge-target" : ""}${
                    dropIntent === "sort-before" ? " sort-before" : ""
                  }${dropIntent === "sort-after" ? " sort-after" : ""}${
                    draggedDirectoryId === directory.directoryId
                      ? " dragging"
                      : ""
                  }`}
                  disabled={isSavingDirectory || isSwitchingDirectory}
                  draggable={!isSavingDirectory && !isSwitchingDirectory}
                  key={directory.directoryId}
                  onClick={() =>
                    void handleActivateDirectory(directory.directoryId)
                  }
                  onDragEnd={() => void handleDragEnd()}
                  onDragOver={(event) =>
                    handleDragOver(event, directory.directoryId)
                  }
                  onDragStart={(event) =>
                    handleDragStart(event, directory.directoryId)
                  }
                  onDrop={(event) =>
                    void handleDrop(event, directory.directoryId)
                  }
                  title={directory.path}
                  type="button"
                >
                  <GripVertical
                    className="workspace-directory-drag-icon"
                    size={13}
                  />
                  {directory.isActive ? (
                    <FolderOpen className="list-icon" size={15} />
                  ) : directory.kind === "ssh" ? (
                    <Server className="list-icon" size={15} />
                  ) : (
                    <Folder className="list-icon" size={15} />
                  )}
                  <span className="workspace-directory-content">
                    <span className="list-label">{directory.name}</span>
                  </span>
                  {dropIntent === "merge" ? (
                    <span className="workspace-directory-merge-icon">
                      <Plus size={12} />
                    </span>
                  ) : (
                    <span className="list-meta">{directory.kind}</span>
                  )}
                </button>
              );
            })
          )}
          {isLoadingMoreDirectories ? (
            <span className="empty-text loading">
              <Loader2 className="spin" size={13} />
              {t("sidebar.loadingMoreDirectories", {
                defaultValue: "Loading more...",
              })}
            </span>
          ) : null}
        </div>
        {addDirectoryMode === "ssh" ? (
          <div className="workspace-directory-ssh-form" ref={sshFormRef}>
            <input
              aria-label={t("sidebar.sshDirectory", {
                defaultValue: "SSH directory",
              })}
              disabled={isSavingDirectory}
              onChange={(event) => setSshDirectoryPath(event.target.value)}
              placeholder={t("sidebar.sshDirectoryPlaceholder", {
                defaultValue: "ssh://user@host:22/path",
              })}
              type="text"
              value={sshDirectoryPath}
            />
            <div className="workspace-directory-ssh-actions">
              <button
                aria-label={t("sidebar.cancelAddDirectory", {
                  defaultValue: "Cancel add directory",
                })}
                className="workspace-directory-icon-btn"
                disabled={isSavingDirectory}
                onClick={handleCancelSshDirectory}
                type="button"
              >
                <X size={14} />
              </button>
              <button
                aria-label={t("sidebar.confirmAddDirectory", {
                  defaultValue: "Confirm add directory",
                })}
                className="workspace-directory-icon-btn confirm"
                disabled={isSavingDirectory || !sshDirectoryPath.trim()}
                onClick={() => void handleAddSshDirectory()}
                type="button"
              >
                {isSavingDirectory ? (
                  <Loader2 className="spin" size={14} />
                ) : (
                  <Check size={14} />
                )}
              </button>
            </div>
          </div>
        ) : null}
        {directoryError ? (
          <span className="workspace-directory-error">{directoryError}</span>
        ) : null}
      </div>
    </div>
  );
}
