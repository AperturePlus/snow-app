import { memo } from "react";
import { GitCommitHorizontal } from "lucide-react";
import { UserMessageActions } from "./UserMessageActions";
import type { UserMessageProps } from "../utils/types";
import { parseContentSegments } from "../../chatInput/fileTagUtils";
import { getFileTypeIcon } from "../../../../utils/fileIcons";

export const UserMessage = memo(
  ({
    content,
    isStreaming,
    onRollback,
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

              if (segment.type === "commit") {
                const chipTitle = `${segment.tag.shortHash} ${segment.tag.message} (${segment.tag.author}, ${segment.tag.date})`;
                return (
                  <span
                    className="user-message-file-chip commit-chip"
                    key={index}
                    title={chipTitle}
                  >
                    <GitCommitHorizontal
                      size={12}
                      className="user-message-file-chip-icon"
                      style={{ color: "#f05032" }}
                    />
                    <span className="user-message-file-chip-name">
                      {segment.tag.shortHash}
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
                  <span className="user-message-file-chip-name">
                    {tag.name}
                  </span>
                </span>
              );
            })}
          </p>
        </article>
        <UserMessageActions
          content={content}
          isStreaming={isStreaming}
          onRollback={onRollback}
        />
      </div>
    );
  }
);

UserMessage.displayName = "UserMessage";
