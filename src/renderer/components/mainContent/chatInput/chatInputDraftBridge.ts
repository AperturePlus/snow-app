type ChatInputDraftSink = (content: string) => void;

let sink: ChatInputDraftSink | null = null;

export const registerChatInputDraftSink = (
  handler: ChatInputDraftSink,
): (() => void) => {
  sink = handler;
  return () => {
    if (sink === handler) {
      sink = null;
    }
  };
};

export const writeBackToChatInput = (content: string): boolean => {
  if (!sink) {
    return false;
  }
  sink(content);
  return true;
};

type SessionDraftSaver = (
  sessionKey: string,
  conversationId: string | null,
  content: string,
) => void;

let sessionDraftSaver: SessionDraftSaver | null = null;

export const registerSessionDraftSaver = (
  handler: SessionDraftSaver,
): (() => void) => {
  sessionDraftSaver = handler;
  return () => {
    if (sessionDraftSaver === handler) {
      sessionDraftSaver = null;
    }
  };
};

export const persistSessionDraft = (
  sessionKey: string,
  conversationId: string | null,
  content: string,
): boolean => {
  if (!sessionDraftSaver) {
    return false;
  }
  sessionDraftSaver(sessionKey, conversationId, content);
  return true;
};
