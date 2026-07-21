import { GitBranch, ChevronDown, GitBranchPlus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { GitBranch as GitBranchType } from "../../../../preload";
import { useI18n } from "../../../i18n";

type BranchSelectorProps = {
  repoPath: string;
  currentBranch: string;
  onBranchChanged: () => void;
};

// Git refname validation: cannot start with ".", "-", end with ".lock"/"/",
// contain "..", "@{", or any of these chars: space ~ ^ : ? * [ \
const BRANCH_NAME_REGEX = /^(?!\.)(?!-)[A-Za-z0-9._/-]+$/;
const BRANCH_NAME_FORBIDDEN = /(?:\.\.|@|\{|}|[ ~^:?*\[\\]|\.lock$|\/$|^\.) /;

const isValidBranchName = (name: string): boolean => {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > 200) {
    return false;
  }
  if (BRANCH_NAME_FORBIDDEN.test(trimmed)) {
    return false;
  }
  return BRANCH_NAME_REGEX.test(trimmed);
};

export const BranchSelector = ({
  repoPath,
  currentBranch,
  onBranchChanged,
}: BranchSelectorProps): React.JSX.Element => {
  const { t } = useI18n();
  const [branches, setBranches] = useState<GitBranchType[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const createInputRef = useRef<HTMLInputElement>(null);

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
        setShowCreate(false);
        setNewBranchName("");
        setCreateError(null);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  useEffect(() => {
    if (showCreate) {
      createInputRef.current?.focus();
    }
  }, [showCreate]);

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

  const handleCreateBranch = (): void => {
    const trimmed = newBranchName.trim();
    if (!isValidBranchName(trimmed)) {
      setCreateError(t("git.createBranchInvalid"));
      return;
    }

    const exists = branches.some(
      (b) => b.name === trimmed || b.name === `origin/${trimmed}`
    );
    if (exists) {
      setCreateError(t("git.createBranchExists"));
      return;
    }

    setCreating(true);
    setCreateError(null);
    window.snow
      .gitCreateBranch(repoPath, trimmed)
      .then((result) => {
        if (result.success) {
          setShowCreate(false);
          setNewBranchName("");
          setIsOpen(false);
          onBranchChanged();
        } else {
          setCreateError(result.message || t("git.createBranchFailed"));
        }
      })
      .catch(() => {
        setCreateError(t("git.createBranchFailed"));
      })
      .finally(() => {
        setCreating(false);
      });
  };

  const handleCreateInputKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>
  ): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleCreateBranch();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setShowCreate(false);
      setNewBranchName("");
      setCreateError(null);
    }
  };

  const handleToggleCreate = (): void => {
    setShowCreate(!showCreate);
    setNewBranchName("");
    setCreateError(null);
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
          {currentBranch || t("git.unknownBranch")}
        </span>
        <ChevronDown size={12} strokeWidth={1.8} />
      </button>
      {isOpen && (
        <div className="branch-dropdown" ref={dropdownRef}>
          {loading ? (
            <div className="branch-dropdown-loading">{t("git.loading")}</div>
          ) : (
            <>
              <div className="branch-dropdown-create">
                {showCreate ? (
                  <div className="branch-create-form">
                    <div className="branch-create-input-row">
                      <input
                        ref={createInputRef}
                        type="text"
                        className="branch-create-input"
                        placeholder={t("git.createBranchPlaceholder")}
                        value={newBranchName}
                        onChange={(e) => {
                          setNewBranchName(e.target.value);
                          setCreateError(null);
                        }}
                        onKeyDown={handleCreateInputKeyDown}
                        disabled={creating}
                        spellCheck={false}
                        autoComplete="off"
                      />
                      <button
                        type="button"
                        className="branch-create-cancel-btn"
                        onClick={handleToggleCreate}
                        disabled={creating}
                        title={t("git.discardCancelBtn")}
                      >
                        <X size={14} strokeWidth={1.8} />
                      </button>
                    </div>
                    <button
                      type="button"
                      className="branch-create-submit-btn"
                      onClick={handleCreateBranch}
                      disabled={
                        creating || newBranchName.trim().length === 0
                      }
                    >
                      {creating ? t("git.loading") : t("git.createBranchSubmit")}
                    </button>
                    {createError && (
                      <div className="branch-create-error">{createError}</div>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    className="branch-create-toggle-btn"
                    onClick={handleToggleCreate}
                  >
                    <GitBranchPlus size={14} strokeWidth={1.8} />
                    <span>{t("git.createBranch")}</span>
                  </button>
                )}
              </div>
              {localBranches.length > 0 && (
                <div className="branch-dropdown-group">
                  <div className="branch-dropdown-label">
                    {t("git.localBranches")}
                  </div>
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
                  <div className="branch-dropdown-label">
                    {t("git.remoteBranches")}
                  </div>
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
                <div className="branch-dropdown-empty">
                  {t("git.noBranches")}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};
