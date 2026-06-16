import { UserMessageActions } from "./UserMessageActions";
import type { UserMessageProps } from "./types";

export const UserMessage = ({
  content,
}: UserMessageProps): React.JSX.Element => (
  <div className="user-message-row">
    <article className="user-message-bubble">
      <p>{content}</p>
    </article>
    <UserMessageActions />
  </div>
);
