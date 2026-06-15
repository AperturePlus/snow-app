import {
  Folder,
  FolderOpen,
  GripVertical,
  Loader2,
  Server,
  Trash2,
} from "lucide-react";
import { createPortal } from "react-dom";
import type { DragEvent, MouseEvent, RefObject } from "react";

import { useI18n } from "../../../i18n";
import type { WorkspaceDirectoryRecord } from "../../../../preload";

export type WorkspaceDirectoryContextMenuState = {
  directoryId: string;
  x: number;
  y: number;
};

type WorkspaceDirectoryListProps = {
  activeDirectoryId?: string;
  contextMenu: WorkspaceDirectoryContextMenuState | null;
  directoryListRef: RefObject<HTMLDivElement | null>;
  draggedDirectoryId: string | null;
  dragOverDirectoryId: string | null;
  hasMoreDirectories: boolean;
  isActionLocked: boolean;
  isLoadingDirectories: boolean;
  loadMoreRef: RefObject<HTMLDivElement | null>;
  onActivate: (directoryId: string) => void;
  onContextMenu: (
    directoryId: string,
    event: MouseEvent<HTMLDivElement>
  ) => void;
  onDelete: (directoryId: string) => void;
  onDragEnd: () => void;
  onDragOver: (directoryId: string) => void;
  onDragStart: (directoryId: string) => void;
  onDrop: (directoryId: string) => void;
  totalCount: number;
  visibleDirectories: WorkspaceDirectoryRecord[];
  workspaceDirectories: WorkspaceDirectoryRecord[];
};

const getDirectoryIcon = (
  directory: WorkspaceDirectoryRecord
): React.JSX.Element => {
  if (directory.isActive) {
    return <FolderOpen className="list-icon" size={15} />;
  }

  if (directory.kind === "ssh") {
    return <Server className="list-icon" size={15} />;
  }

  return <Folder className="list-icon" size={15} />;
};

export function WorkspaceDirectoryList({
  activeDirectoryId,
  contextMenu,
  directoryListRef,
  draggedDirectoryId,
  dragOverDirectoryId,
  hasMoreDirectories,
  isActionLocked,
  isLoadingDirectories,
  loadMoreRef,
  onActivate,
  onContextMenu,
  onDelete,
  onDragEnd,
  onDragOver,
  onDragStart,
  onDrop,
  totalCount,
  visibleDirectories,
  workspaceDirectories,
}: WorkspaceDirectoryListProps): React.JSX.Element {
  const { t } = useI18n();
  const contextDirectory = contextMenu
    ? workspaceDirectories.find(
        (directory) => directory.directoryId === contextMenu.directoryId
      )
    : undefined;

  const handleDragStart = (
    event: DragEvent<HTMLDivElement>,
    directoryId: string
  ): void => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", directoryId);
    onDragStart(directoryId);
  };

  const handleDragOver = (
    event: DragEvent<HTMLDivElement>,
    directoryId: string
  ): void => {
    if (isActionLocked || draggedDirectoryId === directoryId) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    onDragOver(directoryId);
  };

  const handleDrop = (
    event: DragEvent<HTMLDivElement>,
    directoryId: string
  ): void => {
    event.preventDefault();
    onDrop(directoryId);
  };

  return (
    <div
      className="section-list workspace-directory-list"
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
        <>
          {visibleDirectories.map((directory, index) => {
            const isDragging = draggedDirectoryId === directory.directoryId;
            const isDragOver = dragOverDirectoryId === directory.directoryId;

            return (
              <div
                className={`workspace-directory-row${
                  isDragging ? " dragging" : ""
                }${isDragOver ? " drag-over" : ""}`}
                draggable={!isActionLocked}
                key={directory.directoryId}
                onContextMenu={(event) =>
                  onContextMenu(directory.directoryId, event)
                }
                onDragEnd={onDragEnd}
                onDragOver={(event) =>
                  handleDragOver(event, directory.directoryId)
                }
                onDragStart={(event) =>
                  handleDragStart(event, directory.directoryId)
                }
                onDrop={(event) => handleDrop(event, directory.directoryId)}
              >
                <button
                  className={`list-item${
                    directory.directoryId === activeDirectoryId ? " active" : ""
                  }`}
                  disabled={
                    isActionLocked ||
                    directory.directoryId === activeDirectoryId
                  }
                  onClick={() => onActivate(directory.directoryId)}
                  title={directory.path}
                  type="button"
                >
                  <span
                    className="workspace-directory-guide"
                    aria-hidden="true"
                  >
                    <span className="workspace-directory-guide-dot" />
                  </span>
                  <span
                    aria-label={t("sidebar.dragDirectory", {
                      defaultValue: "Drag to reorder",
                    })}
                    className="workspace-directory-drag-handle"
                    role="img"
                  >
                    <GripVertical size={13} />
                  </span>
                  {getDirectoryIcon(directory)}
                  <span className="list-label">{directory.name}</span>
                  <span className="list-meta">{directory.kind}</span>
                  <span className="workspace-directory-index">
                    {index + 1}/{totalCount}
                  </span>
                </button>
              </div>
            );
          })}
          {hasMoreDirectories ? (
            <div
              aria-hidden="true"
              className="workspace-directory-load-more"
              ref={loadMoreRef}
            >
              <Loader2 className="spin" size={13} />
              <span>
                {t("sidebar.loadingMoreDirectories", {
                  defaultValue: "Loading more...",
                })}
              </span>
            </div>
          ) : (
            <div className="workspace-directory-end-line">
              <span>
                {t("sidebar.allDirectoriesLoaded", {
                  defaultValue: "All directories loaded",
                })}
              </span>
            </div>
          )}
        </>
      )}
      {contextDirectory && contextMenu
        ? createPortal(
            <div
              aria-label={t("sidebar.directoryContextMenu", {
                defaultValue: "Directory actions",
              })}
              className="workspace-directory-context-menu"
              onContextMenu={(event) => event.preventDefault()}
              onPointerDown={(event) => event.stopPropagation()}
              role="menu"
              style={{ left: contextMenu.x, top: contextMenu.y }}
            >
              <button
                className="danger"
                disabled={isActionLocked}
                onClick={() => onDelete(contextDirectory.directoryId)}
                role="menuitem"
                type="button"
              >
                <Trash2 size={13} />
                <span>
                  {t("sidebar.deleteDirectory", { defaultValue: "Delete" })}
                </span>
              </button>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
