import { GitBranch, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { GitBranch as GitBranchType } from "../../../../preload";

type BranchSelectorProps = {
  repoPath: string;
  currentBranch: string;
  onBranchChanged: () => void;
};

export const BranchSelector = ({
  repoPath,
  currentBranch,
  onBranchChanged,
}: BranchSelectorProps): React.JSX.Element => {
  const [branches, setBranches] = useState<GitBranchType[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setLoading(true);
    window.snow
      .gitBranches(repoPath)
      .then((result) => {
        setBranches(result);
      })
      .catch(() => {
        // Silent fail
      })
      .finally(() => {
        setLoading(false);
      });
  }, [isOpen, repoPath]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleClickOutside = (event: MouseEvent): void => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const handleCheckout = (branchName: string): void => {
    if (branchName === currentBranch) {
      setIsOpen(false);
      return;
    }

    window.snow
      .gitCheckout(repoPath, branchName)
      .then(() => {
        setIsOpen(false);
        onBranchChanged();
      })
      .catch(() => {
        // Silent fail
      });
  };

  const localBranches = branches.filter((b) => !b.isRemote);
  const remoteBranches = branches.filter((b) => b.isRemote);

  return (
    <div className="branch-selector">
      <button
        type="button"
        className="branch-selector-btn"
        onClick={() => setIsOpen(!isOpen)}
        title={currentBranch}
      >
        <GitBranch size={14} strokeWidth={1.8} />
        <span className="branch-selector-name">
          {currentBranch || "unknown"}
        </span>
        <ChevronDown size={12} strokeWidth={1.8} />
      </button>
      {isOpen && (
        <div className="branch-dropdown" ref={dropdownRef}>
          {loading ? (
            <div className="branch-dropdown-loading">Loading...</div>
          ) : (
            <>
              {localBranches.length > 0 && (
                <div className="branch-dropdown-group">
                  <div className="branch-dropdown-label">Local</div>
                  {localBranches.map((branch) => (
                    <button
                      key={branch.name}
                      type="button"
                      className={`branch-dropdown-item${
                        branch.isCurrent ? " active" : ""
                      }`}
                      onClick={() => handleCheckout(branch.name)}
                    >
                      <span className="branch-dropdown-item-name">
                        {branch.name}
                      </span>
                      {branch.isCurrent && (
                        <span className="branch-dropdown-item-check" />
                      )}
                    </button>
                  ))}
                </div>
              )}
              {remoteBranches.length > 0 && (
                <div className="branch-dropdown-group">
                  <div className="branch-dropdown-label">Remote</div>
                  {remoteBranches.map((branch) => (
                    <button
                      key={branch.name}
                      type="button"
                      className={`branch-dropdown-item${
                        branch.isCurrent ? " active" : ""
                      }`}
                      onClick={() => handleCheckout(branch.name)}
                    >
                      <span className="branch-dropdown-item-name">
                        {branch.name}
                      </span>
                      {branch.isCurrent && (
                        <span className="branch-dropdown-item-check" />
                      )}
                    </button>
                  ))}
                </div>
              )}
              {branches.length === 0 && (
                <div className="branch-dropdown-empty">No branches found</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};
