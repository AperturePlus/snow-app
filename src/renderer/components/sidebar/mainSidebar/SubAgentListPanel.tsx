import { AlertCircle, Bot, Check, CheckCircle2, Loader2 } from "lucide-react";

import { useI18n } from "../../../i18n";
import type { ChatConversationRecord } from "../../../../preload";

type SubAgentListPanelProps = {
  conversations: ChatConversationRecord[];
  activeConversationId?: string;
  onSelect?: (conversationId: string) => void;
  /** 多选模式：点击切换选中而非打开会话 */
  selectionMode?: boolean;
  isSelected?: (conversationId: string) => boolean;
  onToggleSelect?: (conversationId: string) => void;
};

function renderStatusIcon(status: string): React.ReactNode {
  if (status === "running") {
    return <Loader2 size={11} className="spin" />;
  }
  if (status === "failed") {
    return <AlertCircle size={11} className="sub-agent-failed" />;
  }
  if (status === "completed") {
    return <CheckCircle2 size={11} className="sub-agent-completed" />;
  }
  return <Bot size={11} />;
}

/**
 * 子代理列表面板：独立的自包含面板，拥有自己的表面背景，
 * 不依赖父级会话项的选中/悬停状态，避免嵌套背景互相冲突。
 */
export function SubAgentListPanel({
  conversations,
  activeConversationId,
  onSelect,
  selectionMode = false,
  isSelected,
  onToggleSelect,
}: SubAgentListPanelProps): React.JSX.Element {
  const { t } = useI18n();

  const handleItemClick = (
    event: React.MouseEvent,
    conversationId: string
  ): void => {
    // 面板是独立交互区域，阻止点击事件继续冒泡
    event.stopPropagation();
    if (selectionMode) {
      onToggleSelect?.(conversationId);
    } else {
      onSelect?.(conversationId);
    }
  };

  return (
    <div className="sub-agent-list-panel">
      {conversations.map((subAgent) => {
        const isItemSelected = isSelected?.(subAgent.conversationId) ?? false;
        return (
          <div
            key={subAgent.conversationId}
            className={`sub-agent-list-item${
              subAgent.conversationId === activeConversationId ? " active" : ""
            }${selectionMode ? " selection-mode" : ""}${
              isItemSelected ? " selected" : ""
            }`}
            onClick={(event) =>
              handleItemClick(event, subAgent.conversationId)
            }
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                if (selectionMode) {
                  onToggleSelect?.(subAgent.conversationId);
                } else {
                  onSelect?.(subAgent.conversationId);
                }
              }
            }}
          >
            {selectionMode && (
              <span
                className={`chat-item-checkbox${
                  isItemSelected ? " selected" : ""
                }`}
                role="checkbox"
                aria-checked={isItemSelected}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleSelect?.(subAgent.conversationId);
                }}
                onKeyDown={(event) => event.stopPropagation()}
              >
                {isItemSelected && <Check size={11} strokeWidth={3} />}
              </span>
            )}
            <span className="sub-agent-list-icon">
              {renderStatusIcon(subAgent.subAgentStatus)}
            </span>
            <span className="sub-agent-list-name">
              {subAgent.subAgentName ||
                subAgent.title ||
                t("sidebar.subAgent", { defaultValue: "Sub-agent" })}
            </span>
          </div>
        );
      })}
    </div>
  );
}
