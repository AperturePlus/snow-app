import { createContext, useContext, type ReactNode } from "react";
import { useChatConversation } from "./useChatConversation";

type ChatConversationContextValue = ReturnType<typeof useChatConversation>;

const ChatConversationContext = createContext<
  ChatConversationContextValue | undefined
>(undefined);

export const ChatConversationProvider = ({
  children,
  directoryId,
  directoryPath,
}: {
  children: ReactNode;
  directoryId?: string;
  directoryPath?: string;
}): React.JSX.Element => {
  const conversation = useChatConversation(directoryId, directoryPath);

  return (
    <ChatConversationContext.Provider value={conversation}>
      {children}
    </ChatConversationContext.Provider>
  );
};

export const useChatConversationContext = (): ChatConversationContextValue => {
  const context = useContext(ChatConversationContext);

  if (!context) {
    throw new Error(
      "useChatConversationContext must be used within a ChatConversationProvider"
    );
  }

  return context;
};
