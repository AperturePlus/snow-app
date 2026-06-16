import { AiResponseActions } from "./AiResponseActions";
import type { AiResponseProps } from "./types";

export const AiResponse = ({
  title,
  summary,
  sections = [],
}: AiResponseProps): React.JSX.Element => (
  <article className="ai-message" aria-label="AI response">
    <div className="ai-message-content">
      <h2>{title}</h2>
      <div className="ai-message-summary">{summary}</div>
      {sections.map((section) => (
        <section className="ai-message-section" key={section.title}>
          <h3>{section.title}</h3>
          <div className="ai-message-section-body">{section.body}</div>
        </section>
      ))}
    </div>
    <AiResponseActions />
  </article>
);
