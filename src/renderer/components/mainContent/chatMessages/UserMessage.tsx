import { UserMessageActions } from "./UserMessageActions";
import type { UserMessageProps } from "./types";
import { parseContentSegments } from "../chatInput/fileTagUtils";
import { getFileTypeIcon } from "../../../utils/fileIcons";

export const UserMessage = ({
  content,
  messageId,
  onRollback,
  rollbackDisabled = false,
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

            if (segment.type === "image") {
              return (
                <span
                  className="user-message-file-chip image-chip"
                  key={index}
                  title={segment.tag.name}
                >
                  {getFileTypeIcon(segment.tag.name, false, false, {
                    size: 12,
                    className: "user-message-file-chip-icon",
                  })}
                  <span className="user-message-file-chip-name">
                    {segment.tag.name}
                  </span>
                </span>
              );
            }

            const { tag } = segment;
            return (
              <span
                className="user-message-file-chip"
                key={index}
                title={tag.path}
              >
                {getFileTypeIcon(tag.name, tag.isDirectory, false, {
                  size: 12,
                  className: "user-message-file-chip-icon",
                })}
                <span className="user-message-file-chip-name">{tag.name}</span>
              </span>
            );
          })}
        </p>
      </article>
      {onRollback ? (
        <UserMessageActions
          content={content}
          messageId={messageId}
          onRollback={onRollback}
          disabled={rollbackDisabled}
        />
      ) : null}
    </div>
  );
};
