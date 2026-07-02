import { File, Folder } from "lucide-react";
import { UserMessageActions } from "./UserMessageActions";
import type { UserMessageProps } from "./types";
import { parseContentSegments } from "../chatInput/fileTagUtils";

export const UserMessage = ({
  content,
}: UserMessageProps): React.JSX.Element => {
  const segments = parseContentSegments(content);

  return (
    <div className="user-message-row">
      <article className="user-message-bubble">
        <p>
          {segments.map((segment, index) => {
            if (segment.type === "text") {
              return <span key={index}>{segment.content}</span>;
            }

            const { tag } = segment;
            return (
              <span
                className="user-message-file-chip"
                key={index}
                title={tag.path}
              >
                {tag.isDirectory ? (
                  <Folder size={12} className="user-message-file-chip-icon" />
                ) : (
                  <File size={12} className="user-message-file-chip-icon" />
                )}
                <span className="user-message-file-chip-name">{tag.name}</span>
              </span>
            );
          })}
        </p>
      </article>
      <UserMessageActions />
    </div>
  );
};
