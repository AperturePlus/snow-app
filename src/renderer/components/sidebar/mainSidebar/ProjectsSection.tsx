import { Folder, Loader2, Plus, Server } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useI18n } from "../../../i18n";
import { shortcutEvents } from "../../shortcutEvents";
import type {
  WorkspaceDirectoryInput,
  WorkspaceDirectoryKind,
  WorkspaceDirectoryRecord,
} from "../../../../preload";
import { WorkspaceDirectoryList } from "./WorkspaceDirectoryList";

type AddDirectoryMode = "" | WorkspaceDirectoryKind;
type ProjectsSectionProps = {
  activeDirectory?: WorkspaceDirectoryRecord | null;
  onActiveDirectoryChange?: (
    directory: WorkspaceDirectoryRecord | null
  ) => void;
  onSwitchingDirectoryChange: (isSwitchingDirectory: boolean) => void;
  onSwitchContent?: (content: "main" | "explorer") => void;
  onSwitchToExplorer?: (directoryId: string) => void;
  onOpenSshWizard?: () => void;
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
  activeDirectory: externalActiveDirectory,
  onActiveDirectoryChange,
  onSwitchingDirectoryChange,
  onSwitchContent,
  onSwitchToExplorer,
  onOpenSshWizard,
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
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [directoryPage, setDirectoryPage] = useState(1);
  const [draggedDirectoryId, setDraggedDirectoryId] = useState<string | null>(
    null
  );
  const [dragOverDirectoryId, setDragOverDirectoryId] = useState<string | null>(
    null
  );
  const addMenuRef = useRef<HTMLDivElement | null>(null);
  const directoryListRef = useRef<HTMLDivElement | null>(null);
  const directoryLoadMoreRef = useRef<HTMLDivElement | null>(null);

  const activeDirectory = useMemo(
    () => workspaceDirectories.find((directory) => directory.isActive),
    [workspaceDirectories]
  );

  useEffect(() => {
    onActiveDirectoryChange?.(activeDirectory ?? null);
  }, [activeDirectory, onActiveDirectoryChange]);

  const updateSwitchingDirectory = useCallback(
    (nextIsSwitching: boolean): void => {
      setIsSwitchingDirectory(nextIsSwitching);
      onSwitchingDirectoryChange(nextIsSwitching);
    },
    [onSwitchingDirectoryChange]
  );

  // Mirror values into refs so the external-sync effect can read the latest
  // state without re-running on every internal change (which would cause an
  // infinite loop with the upward-sync effect above).
  const activeDirectoryIdRef = useRef<string | undefined>(undefined);
  activeDirectoryIdRef.current = activeDirectory?.directoryId;
  const isSwitchingRef = useRef(isSwitchingDirectory);
  isSwitchingRef.current = isSwitchingDirectory;
  // Tracks the last external directoryId we have already processed so we
  // only react to genuine external changes (e.g. global search), not to
  // our own internal changes echoing back through the parent.
  const lastSyncedExternalIdRef = useRef<string | null>(null);

  // Sync internal state when the active directory changes from outside
  // (e.g. via global search). Only fires on real external changes.
  useEffect(() => {
    if (!externalActiveDirectory) {
      return;
    }
    const externalId = externalActiveDirectory.directoryId;
    // Already processed this external ID
    if (externalId === lastSyncedExternalIdRef.current) {
      return;
    }
    // Internal state already matches
    if (externalId === activeDirectoryIdRef.current) {
      lastSyncedExternalIdRef.current = externalId;
      return;
    }
    // In the middle of a switch
    if (isSwitchingRef.current) {
      return;
    }
    lastSyncedExternalIdRef.current = externalId;
    void (async (): Promise<void> => {
      updateSwitchingDirectory(true);
      setDirectoryError(null);
      try {
        const directories = await window.snow.activateWorkspaceDirectory(
          externalId
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
    })();
  }, [externalActiveDirectory, updateSwitchingDirectory, t]);

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

  const loadWorkspaceDirectories = useCallback(async (): Promise<void> => {
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
  }, [t]);

  useEffect(() => {
    void loadWorkspaceDirectories();
  }, [loadWorkspaceDirectories]);

  // Refresh the directory list whenever another part of the app (e.g. the
  // empty-chat greeting card or the SSH wizard) adds/activates/deletes a
  // workspace directory. The main process broadcasts
  // "workspace-directory-list:changed" after every mutation, so subscribing
  // here keeps the sidebar in sync without coupling components together.
  useEffect(() => {
    const unsubscribe = window.snow.onWorkspaceDirectoryListChanged(() => {
      void loadWorkspaceDirectories();
    });
    return unsubscribe;
  }, [loadWorkspaceDirectories]);

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
    if (!isAddMenuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target;

      if (target instanceof Node && addMenuRef.current?.contains(target)) {
        return;
      }

      setIsAddMenuOpen(false);
      setAddDirectoryMode("");
      setDirectoryError(null);
    };

    window.addEventListener("pointerdown", handlePointerDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [isAddMenuOpen]);

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
      onOpenSshWizard?.();
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

  const handleActivateDirectory = async (
    directoryId: string
  ): Promise<void> => {
    if (!directoryId || directoryId === activeDirectory?.directoryId) {
      return;
    }

    updateSwitchingDirectory(true);
    setDirectoryError(null);

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

  const handleDeleteDirectory = async (directoryId: string): Promise<void> => {
    if (!directoryId) {
      return;
    }

    setIsSavingDirectory(true);
    setDirectoryError(null);

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

  const handleShowDetails = (directoryId: string): void => {
    const directory = workspaceDirectories.find(
      (d) => d.directoryId === directoryId
    );

    if (!directory) {
      return;
    }

    onSwitchToExplorer?.(directory.directoryId);
  };

  // 基于当前位置自上而下循环切换项目。
  // 找到当前激活目录的索引，切换到下一个（末尾则回到第一个）。
  const handleCycleProject = useCallback(() => {
    if (workspaceDirectories.length === 0) return;
    // 切换中或保存中时不响应，避免状态混乱
    if (isSwitchingDirectory || isSavingDirectory || isReorderingDirectories) {
      return;
    }

    const currentIndex = activeDirectory
      ? workspaceDirectories.findIndex(
          (d) => d.directoryId === activeDirectory.directoryId
        )
      : -1;

    // 无当前激活目录时切换到第一个
    if (currentIndex === -1) {
      void handleActivateDirectory(workspaceDirectories[0].directoryId);
      return;
    }

    const nextIndex = (currentIndex + 1) % workspaceDirectories.length;
    const nextDirectory = workspaceDirectories[nextIndex];
    if (nextDirectory && nextDirectory.directoryId !== activeDirectory?.directoryId) {
      void handleActivateDirectory(nextDirectory.directoryId);
    }
  }, [
    workspaceDirectories,
    activeDirectory,
    isSwitchingDirectory,
    isSavingDirectory,
    isReorderingDirectories,
    handleActivateDirectory,
  ]);

  // 订阅快捷键事件：Ctrl/Cmd+` 循环切换项目
  useEffect(() => {
    return shortcutEvents.on("cycle-project", () => {
      handleCycleProject();
    });
  }, [handleCycleProject]);

  return (
    <div className="sidebar-section">
      <div className="section-header">
        <span className="section-title">
          {t("sidebar.projects", { defaultValue: "Projects" })}
        </span>
        <div
          className="section-actions workspace-directory-header-actions"
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
          onDelete={(directoryId) => void handleDeleteDirectory(directoryId)}
          onDragEnd={handleDirectoryDragEnd}
          onDragOver={handleDirectoryDragOver}
          onDragStart={handleDirectoryDragStart}
          onDrop={handleDirectoryDrop}
          onShowDetails={handleShowDetails}
          totalCount={workspaceDirectories.length}
          visibleDirectories={visibleDirectories}
          workspaceDirectories={workspaceDirectories}
        />
        {directoryError ? (
          <span className="workspace-directory-error">{directoryError}</span>
        ) : null}
      </div>
    </div>
  );
}
