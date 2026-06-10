const DIFF_LINES = [
  { type: "context", num: 3, content: "<head>" },
  { type: "context", num: 4, content: '<meta charset="UTF-8" />' },
  {
    type: "context",
    num: 5,
    content:
      '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
  },
  {
    type: "del",
    num: 6,
    content: "<title>Chuck's Burgers | San Francisco Smash Counter</title>",
  },
  {
    type: "add",
    num: 6,
    content:
      "<title>Chuck's Burgers | Late-Night Smash Counter in San Francisco</title>",
  },
  { type: "context", num: 7, content: "<meta" },
  { type: "context", num: 8, content: 'name="description"' },
  {
    type: "context",
    num: 9,
    content: "content=\"Chuck's Burgers is a San Francisco smash counter...",
  },
  {
    type: "add",
    num: 9,
    content: "content=\"Chuck's Burgers is a modern San Francisco smash...",
  },
  {
    type: "context",
    num: 10,
    content: '<link rel="preconnect" href="https://fonts.googleapis.com"',
  },
  {
    type: "context",
    num: 11,
    content:
      '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin',
  },
  { type: "context", num: 12, content: "<link" },
  {
    type: "del",
    num: 13,
    content: 'href="https://fonts.googleapis.com/css2?family=Bebas+Neue...',
  },
  {
    type: "add",
    num: 13,
    content: 'href="https://fonts.googleapis.com/css2?family=Big+Shoulders...',
  },
  { type: "context", num: 14, content: 'rel="stylesheet" />' },
  {
    type: "context",
    num: 15,
    content: '<link rel="stylesheet" href="/src/style.css" />',
  },
  { type: "context", num: 16, content: "</head>" },
  { type: "context", num: 20, content: '<nav class="nav" data-animate>' },
  {
    type: "context",
    num: 21,
    content: '<a class="logo" href="#top" aria-label="Chuck\'s Burgers">',
  },
  {
    type: "context",
    num: 22,
    content: '<span class="logo-mark" aria-hidden="true"></span>',
  },
  {
    type: "del",
    num: 23,
    content: '<span class="logo-text">Chuck\'s Burgers</span>',
  },
  { type: "add", num: 23, content: '<span class="logo-text">' },
  { type: "add", num: 24, content: "<span>Chuck's</span>" },
  { type: "add", num: 25, content: "<strong>Burgers</strong>" },
  { type: "add", num: 26, content: "</span>" },
];

type RightPanelProps = {
  isCollapsed: boolean;
};

export const RightPanel = ({
  isCollapsed,
}: RightPanelProps): React.JSX.Element => {
  return (
    <aside className={`right-panel${isCollapsed ? " collapsed" : ""}`}>
      {/* Review header */}
      <div className="review-header">
        <span className="review-badge">
          Unstaged <span className="badge-count">4</span>
        </span>
        <button className="icon-btn ghost">
          <span>⋯</span>
        </button>
      </div>

      {/* File header */}
      <div className="diff-file-header">
        <button className="diff-expand-btn">▲</button>
        <span className="diff-file-name">index.html</span>
        <span className="diff-file-stats">
          <span className="stat-add">+230</span>
          <span className="stat-del">-150</span>
        </span>
        <button className="diff-expand-btn">▲</button>
      </div>

      {/* Unmodified banner */}
      <div className="diff-banner">
        <span className="diff-banner-icon">▲</span>
        <span>2 unmodified lines</span>
      </div>

      {/* Diff content */}
      <div className="diff-content">
        {DIFF_LINES.map((line, i) => (
          <div key={i} className={`diff-line ${line.type}`}>
            <span className="diff-linenum">{line.num}</span>
            <span className="diff-marker">
              {line.type === "add" ? "+" : line.type === "del" ? "-" : " "}
            </span>
            <code className="diff-code">{line.content}</code>
          </div>
        ))}
      </div>

      {/* Another unmodified banner */}
      <div className="diff-banner">
        <span className="diff-banner-icon">▲</span>
        <span>3 unmodified lines</span>
      </div>

      {/* More diff lines */}
      <div className="diff-content">
        <div className="diff-line context">
          <span className="diff-linenum">20</span>
          <span className="diff-marker"> </span>
          <code className="diff-code">{'<nav class="nav" data-animate>'}</code>
        </div>
        <div className="diff-line context">
          <span className="diff-linenum">21</span>
          <span className="diff-marker"> </span>
          <code className="diff-code">
            {'<a class="logo" href="#top" aria-label="Chuck\'s Burgers">'}
          </code>
        </div>
        <div className="diff-line context">
          <span className="diff-linenum">22</span>
          <span className="diff-marker"> </span>
          <code className="diff-code">
            {'<span class="logo-mark" aria-hidden="true"></span>'}
          </code>
        </div>
        <div className="diff-line del">
          <span className="diff-linenum">23</span>
          <span className="diff-marker">-</span>
          <code className="diff-code">
            {'<span class="logo-text">Chuck\'s Burgers</span>'}
          </code>
        </div>
        <div className="diff-line add">
          <span className="diff-linenum">23</span>
          <span className="diff-marker">+</span>
          <code className="diff-code">{'<span class="logo-text">'}</code>
        </div>
        <div className="diff-line add">
          <span className="diff-linenum">24</span>
          <span className="diff-marker">+</span>
          <code className="diff-code">{"  <span>Chuck's</span>"}</code>
        </div>
        <div className="diff-line add">
          <span className="diff-linenum">25</span>
          <span className="diff-marker">+</span>
          <code className="diff-code">{"  <strong>Burgers</strong>"}</code>
        </div>
        <div className="diff-line add">
          <span className="diff-linenum">26</span>
          <span className="diff-marker">+</span>
          <code className="diff-code">{"</span>"}</code>
        </div>
        <div className="diff-line context">
          <span className="diff-linenum">27</span>
          <span className="diff-marker"> </span>
          <code className="diff-code">{"</a>"}</code>
        </div>
      </div>

      {/* More diff content */}
      <div className="diff-content">
        <div className="diff-line context">
          <span className="diff-linenum">28</span>
          <span className="diff-marker"> </span>
          <code className="diff-code" />
        </div>
        <div className="diff-line context">
          <span className="diff-linenum">29</span>
          <span className="diff-marker"> </span>
          <code className="diff-code">{'<div class="nav-links">'}</code>
        </div>
        <div className="diff-line context">
          <span className="diff-linenum">30</span>
          <span className="diff-marker"> </span>
          <code className="diff-code">{'  <a href="#menu">Menu</a>'}</code>
        </div>
        <div className="diff-line del">
          <span className="diff-linenum">27</span>
          <span className="diff-marker">-</span>
          <code className="diff-code">
            {'  <a href="#story">How We Grill</a>'}
          </code>
        </div>
        <div className="diff-line add">
          <span className="diff-linenum">31</span>
          <span className="diff-marker">+</span>
          <code className="diff-code">{'  <a href="#story">About</a>'}</code>
        </div>
        <div className="diff-line context">
          <span className="diff-linenum">32</span>
          <span className="diff-marker"> </span>
          <code className="diff-code">{'  <a href="#visit">Visit</a>'}</code>
        </div>
        <div className="diff-line context">
          <span className="diff-linenum">33</span>
          <span className="diff-marker"> </span>
          <code className="diff-code">{"</div>"}</code>
        </div>
        <div className="diff-line del">
          <span className="diff-linenum">30</span>
          <span className="diff-marker">-</span>
          <code className="diff-code">
            {'<a class="nav-cta" href="#order">Order pickup</a>'}
          </code>
        </div>
      </div>
    </aside>
  );
};
