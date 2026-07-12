import type { ToolCallInfo } from "./useChatConversation";
export type UserMessageProps = {
  content: string;
  isStreaming: boolean;
  onRollback: () => void;
};

export type AiResponseSection = {
  title: string;
  body: string;
};

export type AiResponseProps = {
  title?: string;
  summary: string;
  thinking?: string;
  sections?: AiResponseSection[];
  isStreaming?: boolean;
  isAborting?: boolean;
  showActions?: boolean;
  toolCalls?: ToolCallInfo[];
  pendingToolAuthorizations?: ToolCallInfo[];
  onApproveToolAuthorization?: (toolCall: ToolCallInfo) => void;
  onApproveToolAuthorizationAlways?: (toolCall: ToolCallInfo) => void;
  onRejectToolAuthorization?: (toolCall: ToolCallInfo) => void;
  conversationId?: string;
  responseId?: string;
  onFork?: (conversationId: string, upToResponseId: string) => void;
};
