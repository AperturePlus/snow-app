/**
 * Storage readiness gate.
 *
 * The Rust native bridge initialises its SQLite database asynchronously via
 * `initializeAppStorage`. Until that finishes, any IPC handler that calls a
 * native database method would fail. To avoid blocking window creation on
 * storage init, we expose a shared Promise that resolves once the database
 * is ready. The Proxy in `nativeBridge.ts` awaits this Promise before
 * forwarding any async call, so individual IPC handlers stay unchanged.
 */

let resolveReady: () => void;
let rejectReady: (reason: unknown) => void;

/** Resolves when `markStorageReady()` is called; rejects on `markStorageFailed()`. */
export const storageReady: Promise<void> = new Promise<void>((resolve, reject) => {
  resolveReady = resolve;
  rejectReady = reject;
});

/** Called by `initializeApplicationServices` on success. */
export const markStorageReady = (): void => {
  resolveReady();
};

/** Called by `initializeApplicationServices` on failure. */
export const markStorageFailed = (reason: unknown): void => {
  rejectReady(reason);
};
