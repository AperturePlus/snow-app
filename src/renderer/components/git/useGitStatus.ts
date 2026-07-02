import { useCallback, useEffect, useRef, useState } from "react";
import type { GitStatusResult } from "../../../preload";

type UseGitStatusResult = {
  status: GitStatusResult | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
};

export const useGitStatus = (
  repoPath: string | undefined | null
): UseGitStatusResult => {
  const [status, setStatus] = useState<GitStatusResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);
  const repoPathRef = useRef<string | null>(null);

  const fetchStatus = useCallback(async () => {
    const path = repoPathRef.current;
    if (!path) {
      setStatus(null);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await window.snow.gitStatus(path);
      if (!cancelledRef.current) {
        setStatus(result);
      }
    } catch (err) {
      if (!cancelledRef.current) {
        setError(
          err instanceof Error ? err.message : "Failed to get git status"
        );
      }
    } finally {
      if (!cancelledRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    repoPathRef.current = repoPath ?? null;

    void fetchStatus();

    if (repoPath) {
      void window.snow.startGitWatch(repoPath);
    }

    const unsubscribe = window.snow.onGitStatusChanged((changedRepoPath) => {
      if (
        !cancelledRef.current &&
        repoPath &&
        changedRepoPath === repoPath
      ) {
        void fetchStatus();
      }
    });

    return () => {
      cancelledRef.current = true;
      unsubscribe();

      if (repoPath) {
        void window.snow.stopGitWatch(repoPath);
      }
    };
  }, [repoPath, fetchStatus]);

  const refresh = useCallback(() => {
    void fetchStatus();
  }, [fetchStatus]);

  return { status, isLoading, error, refresh };
};
