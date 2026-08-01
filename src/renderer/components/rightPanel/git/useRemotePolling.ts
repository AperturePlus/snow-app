import { useEffect } from "react";

const REMOTE_POLL_INTERVAL_MS = 60_000;

/**
 * Periodically runs `git fetch` against the remote so the ahead/behind
 * counts in the status snapshot stay fresh (git only reports "behind"
 * relative to the last fetched remote refs). After each successful fetch
 * `onFetched` is invoked so callers can refresh their status. Works for
 * both local repos (Rust backend) and SSH (`ssh://`) repos.
 *
 * Failures (offline, auth required, no remote) are ignored silently —
 * this is unattended background polling and must never surface errors.
 */
export const useRemotePolling = (
  repoPath: string | undefined | null,
  onFetched: () => void
): void => {
  useEffect(() => {
    if (!repoPath) {
      return;
    }

    let cancelled = false;

    const poll = (): void => {
      // Skip polling while the window is hidden — there is nobody to
      // notify and the next interval will catch up once visible again.
      if (document.hidden) {
        return;
      }

      window.snow
        .gitFetch(repoPath)
        .then((result) => {
          if (!cancelled && result.success) {
            onFetched();
          }
        })
        .catch(() => {
          // Background polling never surfaces errors.
        });
    };

    poll();
    const timer = setInterval(poll, REMOTE_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [repoPath, onFetched]);
};
