import type { ToolCallInfo } from "./conversationTypes";
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
  isRetrying?: boolean;
  retryAttempt?: number;
  retryError?: string;
  /**
   * Cumulative token count produced by the Rust backend for the current
   * streaming iteration. Forwarded to {@link StreamCursor} so the progress
   * is visible at the tail of the streaming AI response.
   */
  streamTokenCount?: number;
  showActions?: boolean;
  toolCalls?: ToolCallInfo[];
  pendingToolAuthorizations?: ToolCallInfo[];
  onApproveToolAuthorization?: (toolCall: ToolCallInfo) => void;
  onApproveToolAuthorizationAlways?: (toolCall: ToolCallInfo) => void;
  onRejectToolAuthorization?: (toolCall: ToolCallInfo, reason: string) => void;
  conversationId?: string;
  responseId?: string;
  onFork?: (conversationId: string, upToResponseId: string) => void;
};
