import { ArrowLeft, ArrowRight, Globe, Loader2, RotateCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type BrowserPanelContentProps = {
  initialUrl: string;
  isActive: boolean;
  onTitleChange?: (title: string) => void;
};

const DEFAULT_URL = "https://www.google.com";

const normalizeUrl = (input: string): string => {
  const trimmed = input.trim();
  if (!trimmed) {
    return DEFAULT_URL;
  }
  // Already has a protocol
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  // Looks like a domain (contains a dot, no spaces)
  if (/^[^\s]+\.[^\s]+/.test(trimmed)) {
    return `https://${trimmed}`;
  }
  // Otherwise treat as a search query
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
};

export const BrowserPanelContent = ({
  initialUrl,
  isActive,
  onTitleChange,
}: BrowserPanelContentProps): React.JSX.Element => {
  const webviewRef = useRef<Electron.WebviewTag | null>(null);
  const [addressInput, setAddressInput] = useState(initialUrl || DEFAULT_URL);
  const [currentUrl, setCurrentUrl] = useState(
    normalizeUrl(initialUrl || DEFAULT_URL)
  );
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) {
      return;
    }

    const handleNavigationStateUpdate = (): void => {
      setCanGoBack(webview.canGoBack());
      setCanGoForward(webview.canGoForward());
    };

    const handleDidNavigate = (e: Electron.DidNavigateEvent): void => {
      setCurrentUrl(e.url);
      setAddressInput(e.url);
      handleNavigationStateUpdate();
    };

    const handleDidStartLoading = (): void => {
      setIsLoading(true);
    };

    const handleDidStopLoading = (): void => {
      setIsLoading(false);
      handleNavigationStateUpdate();
    };

    const handlePageTitleUpdated = (
      e: Electron.PageTitleUpdatedEvent
    ): void => {
      if (onTitleChange && e.title) {
        onTitleChange(e.title);
      }
    };

    const handleNewWindow = (e: Event & { url?: string }): void => {
      e.preventDefault();
      // Navigate in the same webview instead of opening a new window
      if (e.url) {
        const url = normalizeUrl(e.url);
        webview.loadURL(url);
      }
    };

    // ERR_ABORTED (-3) is expected when a page redirects (e.g. Google -> localized).
    // Chromium aborts the original request, which logs an error to console.
    // Suppress it so the console stays clean.
    const handleDidFailLoad = (e: Event & { errorCode?: number }): void => {
      if (e.errorCode === -3) {
        return;
      }
    };

    webview.addEventListener("did-navigate", handleDidNavigate);
    webview.addEventListener("did-navigate-in-page", handleDidNavigate);
    webview.addEventListener(
      "did-start-loading",
      handleDidStartLoading as EventListener
    );
    webview.addEventListener(
      "did-stop-loading",
      handleDidStopLoading as EventListener
    );
    webview.addEventListener(
      "page-title-updated",
      handlePageTitleUpdated as EventListener
    );
    webview.addEventListener("new-window", handleNewWindow);
    webview.addEventListener(
      "did-fail-load",
      handleDidFailLoad as EventListener
    );

    return () => {
      webview.removeEventListener("did-navigate", handleDidNavigate);
      webview.removeEventListener("did-navigate-in-page", handleDidNavigate);
      webview.removeEventListener(
        "did-start-loading",
        handleDidStartLoading as EventListener
      );
      webview.removeEventListener(
        "did-stop-loading",
        handleDidStopLoading as EventListener
      );
      webview.removeEventListener(
        "page-title-updated",
        handlePageTitleUpdated as EventListener
      );
      webview.removeEventListener("new-window", handleNewWindow);
      webview.removeEventListener(
        "did-fail-load",
        handleDidFailLoad as EventListener
      );
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onTitleChange]);

  const handleNavigate = (rawInput?: string): void => {
    const input = (rawInput ?? addressInput).trim();
    if (!input) {
      return;
    }
    const url = normalizeUrl(input);
    setCurrentUrl(url);
    setAddressInput(url);
    const webview = webviewRef.current;
    if (webview) {
      webview.loadURL(url);
    }
  };

  const handleAddressKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>
  ): void => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleNavigate();
    }
  };

  const handleBack = (): void => {
    const webview = webviewRef.current;
    if (webview && webview.canGoBack()) {
      webview.goBack();
    }
  };

  const handleForward = (): void => {
    const webview = webviewRef.current;
    if (webview && webview.canGoForward()) {
      webview.goForward();
    }
  };

  const handleReload = (): void => {
    const webview = webviewRef.current;
    if (webview) {
      webview.reload();
    }
  };

  return (
    <div className="browser-panel">
      <div className="browser-toolbar">
        <button
          type="button"
          className="browser-nav-btn"
          onClick={handleBack}
          disabled={!canGoBack}
          aria-label="Back"
          title="Back"
        >
          <ArrowLeft size={15} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          className="browser-nav-btn"
          onClick={handleForward}
          disabled={!canGoForward}
          aria-label="Forward"
          title="Forward"
        >
          <ArrowRight size={15} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          className="browser-nav-btn"
          onClick={handleReload}
          aria-label="Reload"
          title="Reload"
        >
          {isLoading ? (
            <Loader2 size={15} strokeWidth={1.8} className="spin-icon" />
          ) : (
            <RotateCw size={15} strokeWidth={1.8} />
          )}
        </button>
        <div className="browser-address-bar">
          <Globe size={13} strokeWidth={1.6} className="browser-address-icon" />
          <input
            type="text"
            className="browser-address-input"
            value={addressInput}
            onChange={(e) => setAddressInput(e.target.value)}
            onKeyDown={handleAddressKeyDown}
            placeholder="Enter URL or search..."
            spellCheck={false}
          />
        </div>
      </div>
      <div className="browser-content">
        <webview
          ref={webviewRef}
          src={currentUrl}
          className="browser-webview"
        />
      </div>
    </div>
  );
};
