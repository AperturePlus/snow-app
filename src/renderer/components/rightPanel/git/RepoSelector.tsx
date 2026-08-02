import { FolderGit2, ChevronDown, GitBranch as GitBranchIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { GitRepoInfo } from "../../../../preload";
import { useI18n } from "../../../i18n";

type RepoSelectorProps = {
  repos: GitRepoInfo[];
  selectedRepoPath: string | null;
  onSelect: (path: string) => void;
};

export const RepoSelector = ({
  repos,
  selectedRepoPath,
  onSelect,
}: RepoSelectorProps): React.JSX.Element => {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedRepo = repos.find((r) => r.path === selectedRepoPath);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleClickOutside = (e: MouseEvent): void => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const handleSelect = (path: string): void => {
    onSelect(path);
    setIsOpen(false);
  };

  return (
    <div className="repo-selector" ref={containerRef}>
      <button
        type="button"
        className="repo-selector-btn"
        onClick={() => setIsOpen(!isOpen)}
      >
        <FolderGit2 size={14} strokeWidth={1.8} />
        <span className="repo-selector-name">
          {selectedRepo?.name ?? t("git.selectRepo")}
        </span>
        {selectedRepo?.currentBranch && (
          <span className="repo-selector-branch">
            <GitBranchIcon size={11} strokeWidth={1.8} />
            {selectedRepo.currentBranch}
          </span>
        )}
        <ChevronDown size={12} strokeWidth={1.8} />
      </button>
      {isOpen && (
        <div className="repo-dropdown">
          {repos.map((repo) => (
            <button
              key={repo.path}
              type="button"
              className={`repo-dropdown-item${
                repo.path === selectedRepoPath ? " active" : ""
              }`}
              onClick={() => handleSelect(repo.path)}
            >
              <FolderGit2 size={13} strokeWidth={1.8} />
              <div className="repo-dropdown-info">
                <span className="repo-dropdown-name">{repo.name}</span>
                {repo.currentBranch && (
                  <span className="repo-dropdown-branch">
                    {repo.currentBranch}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
