import type { WorkspaceDirectoryRecord } from "../../../preload";
import { ChatInput } from "./ChatInput";
import { EmptyGreeting } from "./EmptyGreeting";

type ChatContentProps = {
  activeDirectory?: WorkspaceDirectoryRecord | null;
};

export const ChatContent = ({
  activeDirectory,
}: ChatContentProps): React.JSX.Element => {
  return (
    <>
      {/* Chat area */}
      <div className="chat-area">
        <EmptyGreeting activeDirectory={activeDirectory} />
      </div>

      {/* Input area */}
      <ChatInput />
    </>
  );
};
