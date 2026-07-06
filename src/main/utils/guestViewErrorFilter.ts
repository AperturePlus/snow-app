/**
 * Filters out expected navigation-error logs from Electron's internal
 * GUEST_VIEW_MANAGER_CALL IPC handler.
 *
 * When a webview navigates to a URL that redirects (e.g. Cloudflare managed
 * challenge, Google -> localized domain), Chromium aborts the original
 * request with ERR_ABORTED (-3) or ERR_FAILED (-2). The
 * webContents.loadURL() promise rejects, and Electron's IPC wrapper logs:
 *
 *   Error occurred in handler for 'GUEST_VIEW_MANAGER_CALL':
 *     Error: ERR_ABORTED (-3) loading '...'
 *
 * These errors are expected and harmless — the redirect target loads
 * normally afterward. This module wraps console.error to suppress only
 * these specific messages, leaving all other error logging intact.
 *
 * Call {@link installGuestViewErrorFilter} once at startup, before any
 * webview is created.
 */

/** The IPC channel name that appears in the error log prefix. */
const GUEST_VIEW_ERROR_MARKER =
  "Error occurred in handler for 'GUEST_VIEW_MANAGER_CALL'";

/** Chromium error codes that indicate an expected redirect abort. */
const SUPPRESSED_ERROR_CODES = ["ERR_ABORTED", "ERR_FAILED"];

let installed = false;

/**
 * Returns true when the given value is (or contains) a suppressed navigation
 * error code. Checks both the `code` property on Error-like objects and the
 * string representation as a fallback.
 */
const isSuppressedError = (arg: unknown): boolean => {
  if (arg === null || arg === undefined) {
    return false;
  }

  // Primary check: Error objects from Chromium carry a `code` property.
  const code = (arg as { code?: unknown }).code;
  if (typeof code === "string" && SUPPRESSED_ERROR_CODES.includes(code)) {
    return true;
  }

  // Fallback: the error might be stringified into the message.
  const str =
    typeof arg === "string"
      ? arg
      : arg instanceof Error
        ? arg.message
        : "";
  return SUPPRESSED_ERROR_CODES.some((c) => str.includes(c));
};

/**
 * Installs a console.error filter that suppresses GUEST_VIEW_MANAGER_CALL
 * errors for ERR_ABORTED and ERR_FAILED navigation aborts.
 *
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export const installGuestViewErrorFilter = (): void => {
  if (installed) {
    return;
  }
  installed = true;

  const originalConsoleError = console.error;

  console.error = (...args: unknown[]): void => {
    // Fast path: the first argument must be a string containing the marker.
    if (
      typeof args[0] !== "string" ||
      !args[0].includes(GUEST_VIEW_ERROR_MARKER)
    ) {
      originalConsoleError(...args);
      return;
    }

    // Suppress only if any argument carries a suppressed error code.
    if (args.some(isSuppressedError)) {
      return;
    }

    originalConsoleError(...args);
  };
};
