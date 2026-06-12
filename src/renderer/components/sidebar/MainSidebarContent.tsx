import {
  Search,
  LayoutGrid,
  Clock,
  Pin,
  Folder,
  Settings,
  Plus,
} from "lucide-react";
import type { SidebarContentProps } from "./types";

const NAV_ITEMS = [
  { icon: Search, label: "Search" },
  { icon: LayoutGrid, label: "Plugins" },
  { icon: Clock, label: "Automations" },
];

const PINNED_ITEMS = [
  { label: "Review and triage issues", time: "1w" },
  { label: "Redesign app modern UI", time: "1w", active: true },
  { label: "Create flow diagram", time: "2w" },
  { label: "Add icons", time: "1mo" },
];

const PROJECTS = [
  { label: "burger-restaurant" },
  { label: "fitness-tracker" },
  { label: "codex-voxel" },
  { label: "codespottr" },
  { label: "voxel-snake" },
  { label: "jump-and-run" },
];

export function MainSidebarContent({
  onSwitchContent,
}: SidebarContentProps): React.JSX.Element {
  return (
    <>
      <nav className="sidebar-nav">
        {NAV_ITEMS.map((item) => (
          <button key={item.label} className="nav-item">
            <item.icon size={18} strokeWidth={1.8} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {/* Pinned */}
      <div className="sidebar-section">
        <div className="section-header">
          <span className="section-title">Pinned</span>
        </div>
        <div className="section-list">
          {PINNED_ITEMS.map((item) => (
            <button
              key={item.label}
              className={`list-item ${item.active ? "active" : ""}`}
            >
              <Pin size={14} strokeWidth={1.8} className="list-icon" />
              <span className="list-label">{item.label}</span>
              <span className="list-meta">{item.time}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Projects */}
      <div className="sidebar-section">
        <div className="section-header">
          <span className="section-title">Projects</span>
          <div className="section-actions">
            <button className="icon-btn ghost" aria-label="Add project">
              <Plus size={14} />
            </button>
          </div>
        </div>
        <div className="section-list">
          {PROJECTS.map((item) => (
            <button key={item.label} className="list-item">
              <Folder size={14} strokeWidth={1.8} className="list-icon" />
              <span className="list-label">{item.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Chats */}
      <div className="sidebar-section">
        <div className="section-header">
          <span className="section-title">Chats</span>
        </div>
        <div className="section-list">
          <span className="empty-text">No chats</span>
        </div>
      </div>

      {/* Settings */}
      <div className="sidebar-footer">
        <button
          className="nav-item"
          onClick={() => onSwitchContent("settings")}
          type="button"
        >
          <Settings size={18} strokeWidth={1.8} />
          <span>Settings</span>
        </button>
      </div>
    </>
  );
}
