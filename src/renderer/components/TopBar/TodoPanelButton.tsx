import {
  CheckCircle2,
  Circle,
  CircleDot,
  ListChecks,
  Pin,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import { ConfirmDialog } from "../common/ConfirmDialog";
import type { ChatConversationMessage } from "../mainContent/chatMessages/utils/conversationTypes";
import { useTodoPanel } from "../mainContent/chatMessages/hooks/useTodoPanel";
import type {
  TodoItem,
  TodoStatus,
} from "../mainContent/chatMessages/hooks/useTodoPanel";
type TodoPanelButtonProps = {
  messages: ChatConversationMessage[];
  conversationId?: string;
  projectId?: string;
  isRunning?: boolean;
  onOpenChange?: (open: boolean) => void;
  onPinnedChange?: (pinned: boolean) => void;
};

const todoStatusIcon = (status: TodoStatus): typeof Circle => {
  switch (status) {
    case "completed":
      return CheckCircle2;
    case "inProgress":
      return CircleDot;
    default:
      return Circle;
  }
};

const isTodoStatus = (value: unknown): value is TodoStatus =>
  value === "pending" || value === "inProgress" || value === "completed";

const parseTodos = (result: string): TodoItem[] | null => {
  const parsed = JSON.parse(result) as { todos?: unknown[] };
  if (!Array.isArray(parsed.todos)) {
    return null;
  }

  return parsed.todos
    .filter(
      (item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null
    )
    .map((item) => ({
      id: typeof item.id === "string" ? item.id : "",
      content: typeof item.content === "string" ? item.content : "",
      status: isTodoStatus(item.status) ? item.status : "pending",
      createdAt: typeof item.createdAt === "string" ? item.createdAt : "",
      updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : "",
      parentId: typeof item.parentId === "string" ? item.parentId : undefined,
    }))
    .filter((item) => item.id);
};

export const TodoPanelButton = ({
  messages,
  conversationId,
  projectId,
  isRunning = false,
  onOpenChange,
  onPinnedChange,
}: TodoPanelButtonProps): React.JSX.Element | null => {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedTodoIds, setSelectedTodoIds] = useState<Set<string>>(
    () => new Set()
  );
  const [confirmDeleteIds, setConfirmDeleteIds] = useState<string[] | null>(
    null
  );
  const [localTodos, setLocalTodos] = useState<TodoItem[] | null>(null);
  const [fallbackTodos, setFallbackTodos] = useState<TodoItem[] | null>(null);
  const [fallbackSessionId, setFallbackSessionId] = useState<string | null>(
    null
  );
  const panelRef = useRef<HTMLDivElement>(null);

  const panel = useTodoPanel(messages);
  const panelSessionId = panel.sessionId;
  const panelTodos = panel.todos;

  // When the paginated history loader hasn't loaded the messages containing
  // the todo tool call (sessionId is null), fall back to a lightweight backend
  // query that searches the entire conversation for the latest todo-manage
  // tool result. This keeps the TopBar TODO button visible without forcing
  // the user to scroll up and trigger pagination.
  useEffect(() => {
    if (panelSessionId || !conversationId) {
      setFallbackTodos(null);
      setFallbackSessionId(null);
      return;
    }

    let cancelled = false;
    void window.snow
      .findLatestToolResult(conversationId, "todo-todo-manage")
      .then((result) => {
        if (cancelled || !result) {
          return;
        }
        const parsed = parseTodos(result);
        if (parsed) {
          // Extract sessionId from the raw result for subsequent MCP calls.
          try {
            const raw = JSON.parse(result) as { sessionId?: unknown };
            if (typeof raw.sessionId === "string") {
              setFallbackSessionId(raw.sessionId);
            }
          } catch {
            // Ignore parse errors — sessionId stays null
          }
          setFallbackTodos(parsed);
        }
      })
      .catch(() => {
        // Silent fail
      });

    return () => {
      cancelled = true;
    };
  }, [conversationId, panelSessionId]);

  const sessionId = panelSessionId ?? fallbackSessionId;
  // Priority: user-initiated localTodos > panelTodos (from loaded messages)
  // > fallbackTodos (from backend query). When sessionId exists, localTodos
  // takes precedence so delete operations are reflected immediately.
  const todos = sessionId
    ? localTodos ?? (panelSessionId ? panelTodos : fallbackTodos ?? [])
    : [];
  const totalCount = todos.length;
  const completedCount = todos.filter(
    (todo) => todo.status === "completed"
  ).length;
  const incompleteCount = totalCount - completedCount;
  const selectedCount = selectedTodoIds.size;
  const allSelected = selectedCount === totalCount;

  useEffect(() => {
    if (!sessionId) {
      setLocalTodos(null);
      return;
    }

    let cancelled = false;
    void window.snow
      .callMcpTool(
        "todo-todo-manage",
        JSON.stringify({ action: "get", sessionId }),
        projectId,
        undefined,
        undefined,
        undefined
      )
      .then((result) => {
        if (!cancelled) {
          const fetchedTodos = parseTodos(result);
          if (fetchedTodos) {
            setLocalTodos(fetchedTodos);
          }
        }
      })
      .catch(() => {
        // Silent fail
      });

    return () => {
      cancelled = true;
    };
  }, [messages, projectId, sessionId]);

  useEffect(() => {
    onOpenChange?.(isOpen);
  }, [isOpen, onOpenChange]);

  useEffect(() => {
    onPinnedChange?.(isPinned);
  }, [isPinned, onPinnedChange]);

  useEffect(() => {
    if (!isOpen) {
      setSelectedTodoIds(new Set());
      return undefined;
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (isPinned) {
        return;
      }
      if (
        panelRef.current &&
        !panelRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("pointerdown", handleClickOutside, true);
    return () => {
      document.removeEventListener("pointerdown", handleClickOutside, true);
    };
  }, [isOpen, isPinned]);

  useEffect(() => {
    if (isRunning) {
      setSelectedTodoIds(new Set());
    }
  }, [isRunning]);

  const handleDelete = useCallback(
    async (todoIds: string[]): Promise<void> => {
      if (!sessionId || todoIds.length === 0) {
        return;
      }

      setIsDeleting(true);
      try {
        const result = await window.snow.callMcpTool(
          "todo-todo-manage",
          JSON.stringify({ action: "delete", sessionId, todoId: todoIds }),
          projectId,
          undefined,
          undefined,
          undefined
        );
        const newTodos = parseTodos(result);
        if (newTodos) {
          setLocalTodos(newTodos);
          setSelectedTodoIds(new Set());
        }
      } catch {
        // Silent fail
      } finally {
        setIsDeleting(false);
      }
    },
    [projectId, sessionId]
  );

  const toggleTodoSelection = (todoId: string): void => {
    setSelectedTodoIds((current) => {
      const next = new Set(current);
      if (next.has(todoId)) {
        next.delete(todoId);
      } else {
        next.add(todoId);
      }
      return next;
    });
  };

  const toggleAllSelection = (): void => {
    setSelectedTodoIds(() =>
      allSelected ? new Set() : new Set(todos.map((todo) => todo.id))
    );
  };

  if (totalCount === 0) {
    return null;
  }

  return (
    <div className="top-bar-todo-menu" ref={panelRef}>
      <button
        className={`icon-btn ghost top-bar-todo-btn${isOpen ? " active" : ""}`}
        type="button"
        aria-label={t("topBar.todo.title")}
        title={t("topBar.todo.title")}
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        <ListChecks size={16} strokeWidth={1.8} />
        {incompleteCount > 0 ? (
          <span className="top-bar-todo-badge">{incompleteCount}</span>
        ) : null}
      </button>
      {isOpen ? (
        <div className="top-bar-todo-dropdown">
          <div className="top-bar-todo-dropdown-header">
            <span className="top-bar-todo-dropdown-title">
              {t("topBar.todo.title")}
            </span>
            <div className="top-bar-todo-dropdown-header-actions">
              <span className="top-bar-todo-dropdown-count">
                {t("topBar.todo.progress", {
                  values: { completed: completedCount, total: totalCount },
                })}
              </span>
              <button
                className={`top-bar-todo-pin-btn${isPinned ? " active" : ""}`}
                type="button"
                aria-label={t("topBar.todo.pin")}
                title={t("topBar.todo.pin")}
                aria-pressed={isPinned}
                onClick={() => setIsPinned((pinned) => !pinned)}
              >
                <Pin size={13} strokeWidth={1.8} />
              </button>
            </div>
          </div>
          {!isRunning ? (
            <div className="top-bar-todo-selection-toolbar">
              <label className="top-bar-todo-select-all">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAllSelection}
                  aria-label={t("topBar.todo.selectAll")}
                />
                <span>{t("topBar.todo.selectAll")}</span>
              </label>
              {selectedCount > 0 ? (
                <>
                  <span className="top-bar-todo-selected-count">
                    {t("topBar.todo.selectedCount", {
                      values: { count: selectedCount },
                    })}
                  </span>
                  <button
                    className="top-bar-todo-delete-selected"
                    type="button"
                    disabled={isDeleting || !sessionId}
                    onClick={() =>
                      setConfirmDeleteIds(Array.from(selectedTodoIds))
                    }
                  >
                    <Trash2 size={12} aria-hidden="true" />
                    <span>{t("topBar.todo.deleteSelected")}</span>
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
          <ul className="top-bar-todo-list">
            {todos.map((todo) => {
              const StatusIcon = todoStatusIcon(todo.status);
              const isSelected = selectedTodoIds.has(todo.id);
              return (
                <li
                  key={todo.id}
                  className={`top-bar-todo-item top-bar-todo-item-${todo.status}`}
                >
                  {!isRunning ? (
                    <input
                      className="top-bar-todo-item-select"
                      type="checkbox"
                      checked={isSelected}
                      disabled={isDeleting || !sessionId}
                      onChange={() => toggleTodoSelection(todo.id)}
                      aria-label={t("topBar.todo.selectTodo")}
                    />
                  ) : null}
                  <StatusIcon
                    size={13}
                    className="top-bar-todo-item-icon"
                    aria-hidden="true"
                  />
                  <span className="top-bar-todo-item-content">
                    {todo.content}
                  </span>
                  {!isRunning ? (
                    <button
                      className="top-bar-todo-item-delete"
                      type="button"
                      aria-label={t("topBar.todo.confirmDelete")}
                      title={t("topBar.todo.confirmDelete")}
                      disabled={isDeleting || !sessionId}
                      onClick={() => setConfirmDeleteIds([todo.id])}
                    >
                      <Trash2 size={12} />
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      <ConfirmDialog
        open={confirmDeleteIds !== null}
        variant="danger"
        title={t("topBar.todo.confirmDeleteTitle")}
        message={
          confirmDeleteIds?.length === 1
            ? t("topBar.todo.confirmDeleteMessage")
            : t("topBar.todo.confirmDeleteMultipleMessage", {
                values: { count: confirmDeleteIds?.length ?? 0 },
              })
        }
        confirmLabel={t("topBar.todo.confirmDelete")}
        cancelLabel={t("topBar.todo.cancelDelete")}
        onConfirm={() => {
          if (confirmDeleteIds) {
            void handleDelete(confirmDeleteIds);
          }
          setConfirmDeleteIds(null);
        }}
        onCancel={() => setConfirmDeleteIds(null)}
      />
    </div>
  );
};
