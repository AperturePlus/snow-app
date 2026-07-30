import { useCallback, useEffect, useRef, useState } from "react";
import type { GitRepoInfo } from "../../../../preload";

type UseGitReposResult = {
  repos: GitRepoInfo[];
  isLoading: boolean;
  selectedRepoPath: string | null;
  setSelectedRepoPath: (path: string | null) => void;
  refresh: () => void;
};

const isSshPath = (path: string): boolean => path.startsWith("ssh://");

/**
 * Discovers all git repositories within the active workspace directory.
 *
 * When the workspace directory changes, this hook calls the Rust backend
 * to recursively scan for `.git` folders. The first discovered repo
 * (or the workspace directory itself if it is a repo) is auto-selected.
 *
 * If exactly one repo is found, it is selected automatically. If multiple
 * repos are found, the user can switch between them via the RepoSelector
 * dropdown. If no repos are found, selectedRepoPath remains null and the
 * UI shows an appropriate empty state.
 */
export const useGitRepos = (
  workspacePath: string | undefined | null
): UseGitReposResult => {
  const [repos, setRepos] = useState<GitRepoInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedRepoPath, setSelectedRepoPathState] =
    useState<string | null>(null);
  const workspacePathRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);

  const fetchRepos = useCallback(async () => {
    const path = workspacePathRef.current;
    if (!path || isSshPath(path)) {
      setRepos([]);
      setSelectedRepoPathState(null);
      return;
    }

    const myId = ++requestIdRef.current;
    setIsLoading(true);

    try {
      const result = await window.snow.discoverGitRepos(path);
      if (myId === requestIdRef.current) {
        setRepos(result);
        // Auto-select: if there's exactly one repo, use it. If multiple,
        // select the first one (user can switch via dropdown). If the
        // selected repo is no longer in the list, reset to the first.
        setSelectedRepoPathState((prev) => {
          if (result.length === 0) {
            return null;
          }
          if (prev && result.some((r) => r.path === prev)) {
            return prev;
          }
          return result[0].path;
        });
      }
    } catch {
      if (myId === requestIdRef.current) {
        setRepos([]);
        setSelectedRepoPathState(null);
      }
    } finally {
      if (myId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    workspacePathRef.current = workspacePath ?? null;
    void fetchRepos();
  }, [workspacePath, fetchRepos]);

  const setSelectedRepoPath = useCallback((path: string | null) => {
    setSelectedRepoPathState(path);
  }, []);

  const refresh = useCallback(() => {
    void fetchRepos();
  }, [fetchRepos]);

  return {
    repos,
    isLoading,
    selectedRepoPath,
    setSelectedRepoPath,
    refresh,
  };
};
