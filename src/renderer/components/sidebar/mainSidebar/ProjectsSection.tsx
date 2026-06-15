import { Check, Folder, Loader2, Plus, Server, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";

import { useI18n } from "../../../i18n";
import type {
  WorkspaceDirectoryInput,
  WorkspaceDirectoryKind,
  WorkspaceDirectoryRecord,
} from "../../../../preload";
import {
  WorkspaceDirectoryList,
  type WorkspaceDirectoryContextMenuState,
} from "./WorkspaceDirectoryList";

type AddDirectoryMode = "" | WorkspaceDirectoryKind;
type ProjectsSectionProps = {
  activeDirectory?: WorkspaceDirectoryRecord | null;
  onActiveDirectoryChange?: (
    directory: WorkspaceDirectoryRecord | null
  ) => void;
  onSwitchingDirectoryChange: (isSwitchingDirectory: boolean) => void;
};

const DIRECTORY_PAGE_SIZE = 12;

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
    isActive: true,
    sortOrder: existingCount,
    source: "manual",
  };
};

const toPersistableDirectoryInput = (
  directory: WorkspaceDirectoryRecord,
  sortOrder: number
): WorkspaceDirectoryInput => ({
  directoryId: directory.directoryId,
  name: directory.name,
  path: directory.path,
  kind: directory.kind,
  isActive: directory.isActive,
  sortOrder,
  source: directory.source,
});

export function ProjectsSection({
  onActiveDirectoryChange,
  onSwitchingDirectoryChange,
}: ProjectsSectionProps): React.JSX.Element {
  const { t } = useI18n();
  const [workspaceDirectories, setWorkspaceDirectories] = useState<
    WorkspaceDirectoryRecord[]
  >([]);
  const [isLoadingDirectories, setIsLoadingDirectories] = useState(true);
  const [isSavingDirectory, setIsSavingDirectory] = useState(false);
  const [isReorderingDirectories, setIsReorderingDirectories] = useState(false);
  const [isSwitchingDirectory, setIsSwitchingDirectory] = useState(false);
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [addDirectoryMode, setAddDirectoryMode] =
    useState<AddDirectoryMode>("");
  const [sshDirectoryPath, setSshDirectoryPath] = useState("");
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [directoryPage, setDirectoryPage] = useState(1);
  const [draggedDirectoryId, setDraggedDirectoryId] = useState<string | null>(
    null
  );
  const [dragOverDirectoryId, setDragOverDirectoryId] = useState<string | null>(
    null
  );
  const [contextMenu, setContextMenu] =
    useState<WorkspaceDirectoryContextMenuState | null>(null);
  const addMenuRef = useRef<HTMLDivElement | null>(null);
  const sshFormRef = useRef<HTMLDivElement | null>(null);
  const directoryListRef = useRef<HTMLDivElement | null>(null);
  const directoryLoadMoreRef = useRef<HTMLDivElement | null>(null);

  const activeDirectory = useMemo(
    () => workspaceDirectories.find((directory) => directory.isActive),
    [workspaceDirectories]
  );

  useEffect(() => {
    onActiveDirectoryChange?.(activeDirectory ?? null);
  }, [activeDirectory, onActiveDirectoryChange]);

  const visibleDirectoryCount = directoryPage * DIRECTORY_PAGE_SIZE;
  const visibleDirectories = useMemo(
    () => workspaceDirectories.slice(0, visibleDirectoryCount),
    [visibleDirectoryCount, workspaceDirectories]
  );
  const hasMoreDirectories =
    visibleDirectoryCount < workspaceDirectories.length;

  const loadNextDirectoryPage = useCallback((): void => {
    setDirectoryPage((currentPage) => {
      const maxPage = Math.ceil(
        workspaceDirectories.length / DIRECTORY_PAGE_SIZE
      );

      return Math.min(currentPage + 1, Math.max(maxPage, 1));
    });
  }, [workspaceDirectories.length]);

  const updateSwitchingDirectory = (nextIsSwitching: boolean): void => {
    setIsSwitchingDirectory(nextIsSwitching);
    onSwitchingDirectoryChange(nextIsSwitching);
  };

  const loadWorkspaceDirectories = async (): Promise<void> => {
    setDirectoryError(null);

    try {
      const directories = await window.snow.listWorkspaceDirectories();
      setWorkspaceDirectories(directories);
    } catch (error) {
      setDirectoryError(
        error instanceof Error
          ? error.message
          : t("sidebar.loadDirectoriesError", {
              defaultValue: "Failed to load workspace directories",
            })
      );
    } finally {
      setIsLoadingDirectories(false);
    }
  };

  useEffect(() => {
    void loadWorkspaceDirectories();
  }, []);

  useEffect(() => {
    setDirectoryPage(1);
  }, [workspaceDirectories.length]);

  useEffect(() => {
    if (!hasMoreDirectories) {
      return;
    }

    const sentinel = directoryLoadMoreRef.current;
    const scrollRoot = directoryListRef.current;

    if (!sentinel || !scrollRoot) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          loadNextDirectoryPage();
        }
      },
      {
        root: scrollRoot,
        rootMargin: "0px 0px 32px",
        threshold: 0.1,
      }
    );

    observer.observe(sentinel);

    return () => {
      observer.disconnect();
    };
  }, [hasMoreDirectories, loadNextDirectoryPage, visibleDirectories.length]);

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

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const handlePointerDown = (): void => {
      setContextMenu(null);
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  const persistWorkspaceDirectory = async (
    item: WorkspaceDirectoryInput
  ): Promise<void> => {
    setIsSavingDirectory(true);
    setDirectoryError(null);

    try {
      const directories = await window.snow.upsertWorkspaceDirectory(item);
      setWorkspaceDirectories(directories);
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
            workspaceDirectories.length
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
      toWorkspaceDirectoryInput(trimmedPath, "ssh", workspaceDirectories.length)
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
    setContextMenu(null);

    try {
      const directories = await window.snow.activateWorkspaceDirectory(
        directoryId
      );
      setWorkspaceDirectories(directories);
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

  const persistWorkspaceDirectoryOrder = async (
    orderedDirectories: WorkspaceDirectoryRecord[]
  ): Promise<void> => {
    setIsReorderingDirectories(true);
    setDirectoryError(null);

    try {
      const nextInputs = orderedDirectories.map((directory, index) =>
        toPersistableDirectoryInput(directory, index)
      );
      const directories = await window.snow.reorderWorkspaceDirectories(
        nextInputs
      );
      setWorkspaceDirectories(directories);
    } catch (error) {
      setDirectoryError(
        error instanceof Error
          ? error.message
          : t("sidebar.reorderDirectoryError", {
              defaultValue: "Failed to reorder workspace directories",
            })
      );
    } finally {
      setIsReorderingDirectories(false);
    }
  };

  const handleDirectoryDragStart = (directoryId: string): void => {
    setDraggedDirectoryId(directoryId);
    setDragOverDirectoryId(null);
    setContextMenu(null);
  };

  const handleDirectoryDragOver = (directoryId: string): void => {
    setDragOverDirectoryId(directoryId);
  };

  const handleDirectoryDragEnd = (): void => {
    setDraggedDirectoryId(null);
    setDragOverDirectoryId(null);
  };

  const handleDirectoryDrop = (targetDirectoryId: string): void => {
    if (!draggedDirectoryId || draggedDirectoryId === targetDirectoryId) {
      handleDirectoryDragEnd();
      return;
    }

    const sourceIndex = workspaceDirectories.findIndex(
      (directory) => directory.directoryId === draggedDirectoryId
    );
    const targetIndex = workspaceDirectories.findIndex(
      (directory) => directory.directoryId === targetDirectoryId
    );

    if (sourceIndex < 0 || targetIndex < 0) {
      handleDirectoryDragEnd();
      return;
    }

    const nextDirectories = [...workspaceDirectories];
    const [movedDirectory] = nextDirectories.splice(sourceIndex, 1);
    nextDirectories.splice(targetIndex, 0, movedDirectory);
    setWorkspaceDirectories(nextDirectories);
    handleDirectoryDragEnd();
    void persistWorkspaceDirectoryOrder(nextDirectories);
  };

  const handleDirectoryContextMenu = (
    directoryId: string,
    event: MouseEvent<HTMLDivElement>
  ): void => {
    event.preventDefault();
    setContextMenu({
      directoryId,
      x: event.clientX,
      y: event.clientY,
    });
  };

  const handleDeleteDirectory = async (directoryId: string): Promise<void> => {
    if (!directoryId) {
      return;
    }

    setIsSavingDirectory(true);
    setDirectoryError(null);
    setContextMenu(null);

    try {
      const directories = await window.snow.deleteWorkspaceDirectory(
        directoryId
      );
      setWorkspaceDirectories(directories);
    } catch (error) {
      setDirectoryError(
        error instanceof Error
          ? error.message
          : t("sidebar.deleteDirectoryError", {
              defaultValue: "Failed to delete workspace directory",
            })
      );
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
        </span>
        <WorkspaceDirectoryList
          activeDirectoryId={activeDirectory?.directoryId}
          contextMenu={contextMenu}
          directoryListRef={directoryListRef}
          draggedDirectoryId={draggedDirectoryId}
          dragOverDirectoryId={dragOverDirectoryId}
          hasMoreDirectories={hasMoreDirectories}
          isActionLocked={
            isSavingDirectory || isReorderingDirectories || isSwitchingDirectory
          }
          isLoadingDirectories={isLoadingDirectories}
          loadMoreRef={directoryLoadMoreRef}
          onActivate={(directoryId) =>
            void handleActivateDirectory(directoryId)
          }
          onContextMenu={handleDirectoryContextMenu}
          onDelete={(directoryId) => void handleDeleteDirectory(directoryId)}
          onDragEnd={handleDirectoryDragEnd}
          onDragOver={handleDirectoryDragOver}
          onDragStart={handleDirectoryDragStart}
          onDrop={handleDirectoryDrop}
          totalCount={workspaceDirectories.length}
          visibleDirectories={visibleDirectories}
          workspaceDirectories={workspaceDirectories}
        />
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
