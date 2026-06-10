import {
  Plus,
  Hand,
  ChevronDown,
  Mic,
  ArrowUp,
  Undo,
  FileText,
} from "lucide-react";

const FILE_CHANGES = [
  { name: "index.html", add: 324, del: 0, expanded: true },
  { name: "src/main.js", add: 51, del: 0, expanded: false },
  { name: "src/style.css", add: 1108, del: 0, expanded: false },
  { name: "src/style.css", add: 23, del: 16, expanded: false },
];

export const MainContent = (): React.JSX.Element => {
  return (
    <main className="main-content">
      {/* Chat area */}
      <div className="chat-area">
        {/* User message */}
        <div className="user-message-row">
          <div className="user-message-bubble">
            Redesign the app to be more modern
          </div>
        </div>

        {/* Previous messages toggle */}
        <button className="previous-messages">33 previous messages &gt;</button>

        {/* AI response */}
        <div className="ai-message">
          <p>
            Redesigned the site around a more image-led, editorial direction.
            The new layout gives Chuck&apos;s a stronger first impression with a
            photo-driven hero, sharper typography, cleaner menu grouping, better
            section rhythm, and a more polished final visit CTA in{" "}
            <a href="#">index.html</a> (line 38). The new visual system,
            responsive behavior, and motion styling live in{" "}
            <a href="#">src/style.css</a> (line 1), and the reveal behavior is
            now handled with an <code>IntersectionObserver</code> plus a subtle
            hero tilt interaction in <a href="#">src/main.js</a> (line 1).
          </p>
          <p>
            <code>npm run build</code> passes, and I spot-checked the live page
            with Playwright after the update. There&apos;s also an existing
            untracked <code>public/</code> directory in the repo that I left
            untouched.
          </p>
        </div>

        {/* File changes summary */}
        <div className="file-changes-card">
          <div className="file-changes-header">
            <span>4 files changed +1506 -16</span>
            <button className="undo-btn">
              <Undo size={12} />
              <span>Undo</span>
            </button>
          </div>
          <div className="file-changes-list">
            {FILE_CHANGES.map((file) => (
              <button
                key={file.name + file.add + file.del}
                className="file-change-item"
              >
                <div className="file-change-info">
                  <FileText size={14} className="file-icon" />
                  <span className="file-name">{file.name}</span>
                </div>
                <div className="file-change-stats">
                  <span className="stat-add">+{file.add}</span>
                  <span className="stat-del">-{file.del}</span>
                  <span className="expand-icon">
                    {file.expanded ? "▼" : "▶"}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Input area */}
      <div className="input-area">
        <div className="input-box">
          <input
            type="text"
            placeholder="Ask for follow-up changes"
            className="input-field"
          />
        </div>
        <div className="input-toolbar">
          <div className="toolbar-left">
            <button className="toolbar-btn" aria-label="Add attachment">
              <Plus size={16} />
            </button>
            <button
              className="toolbar-btn permissions"
              aria-label="Permissions"
            >
              <Hand size={14} />
              <span>Default permissions</span>
              <ChevronDown size={12} />
            </button>
          </div>
          <div className="toolbar-right">
            <button className="toolbar-btn model" aria-label="Model">
              <span className="model-icon">⚡</span>
              <span>GPT-5.4</span>
              <ChevronDown size={12} />
            </button>
            <button className="toolbar-btn quality" aria-label="Quality">
              <span>Extra High</span>
              <ChevronDown size={12} />
            </button>
            <button className="toolbar-btn" aria-label="Voice">
              <Mic size={16} />
            </button>
            <button className="send-btn" aria-label="Send">
              <ArrowUp size={16} />
            </button>
          </div>
        </div>
      </div>
    </main>
  );
};
