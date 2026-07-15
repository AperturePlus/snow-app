import {
  CheckCircle2,
  Circle,
  CircleDot,
  ListChecks,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import { ConfirmDialog } from "../common/ConfirmDialog";
import type { ChatConversationMessage } from "../mainContent/chatMessages/useChatConversation";
import { useTodoPanel } from "../mainContent/chatMessages/useTodoPanel";
import type {
  TodoItem,
  TodoStatus,
} from "../mainContent/chatMessages/useTodoPanel";
type TodoPanelButtonProps = {
  messages: ChatConversationMessage[];
  projectId?: string;
  onOpenChange?: (open: boolean) => void;
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
  projectId,
  onOpenChange,
}: TodoPanelButtonProps): React.JSX.Element | null => {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedTodoIds, setSelectedTodoIds] = useState<Set<string>>(
    () => new Set()
  );
  const [confirmDeleteIds, setConfirmDeleteIds] = useState<string[] | null>(
    null
  );
  const [localTodos, setLocalTodos] = useState<TodoItem[] | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const panel = useTodoPanel(messages);
  const sessionId = panel.sessionId;
  const todos = sessionId ? localTodos ?? [] : panel.todos;
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
        "mcp__todo__todo-manage",
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
    if (!isOpen) {
      setSelectedTodoIds(new Set());
      return undefined;
    }

    const handleClickOutside = (event: MouseEvent) => {
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
  }, [isOpen]);

  const handleDelete = useCallback(
    async (todoIds: string[]): Promise<void> => {
      if (!sessionId || todoIds.length === 0) {
        return;
      }

      setIsDeleting(true);
      try {
        const result = await window.snow.callMcpTool(
          "mcp__todo__todo-manage",
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
            <span className="top-bar-todo-dropdown-count">
              {t("topBar.todo.progress", {
                values: { completed: completedCount, total: totalCount },
              })}
            </span>
          </div>
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
          <ul className="top-bar-todo-list">
            {todos.map((todo) => {
              const StatusIcon = todoStatusIcon(todo.status);
              const isSelected = selectedTodoIds.has(todo.id);
              return (
                <li
                  key={todo.id}
                  className={`top-bar-todo-item top-bar-todo-item-${todo.status}`}
                >
                  <input
                    className="top-bar-todo-item-select"
                    type="checkbox"
                    checked={isSelected}
                    disabled={isDeleting || !sessionId}
                    onChange={() => toggleTodoSelection(todo.id)}
                    aria-label={t("topBar.todo.selectTodo")}
                  />
                  <StatusIcon
                    size={13}
                    className="top-bar-todo-item-icon"
                    aria-hidden="true"
                  />
                  <span className="top-bar-todo-item-content">
                    {todo.content}
                  </span>
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
