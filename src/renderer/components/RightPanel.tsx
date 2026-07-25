import { X } from "lucide-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import { useI18n } from "../i18n";
import { GitPanelContent } from "./rightPanel/GitPanelContent";
import { DiffViewer } from "./rightPanel/DiffViewer";
import { FileViewerContent } from "./rightPanel/FileViewerContent";
import { TerminalPanelContent } from "./rightPanel/TerminalPanelContent";
import { BrowserPanelContent } from "./rightPanel/BrowserPanelContent";
import { FileDiffPreview } from "./common/FileDiffPreview";
import { useBrowserMcpCommandBridge } from "./rightPanel/browser/useBrowserMcpCommandBridge";
import {
  rightPanelEvents,
  type OpenFileDiffPreviewPayload,
} from "./rightPanel/rightPanelEvents";
import { generateComparePatch } from "./common/GitDiffView";
import type {
  BrowserTabData,
  DiffTabData,
  FileDiffPreviewTabData,
  FileViewerTabData,
  OpenDiffTabCallback,
  RightPanelContentProps,
  RightPanelTab,
  TerminalTabData,
} from "./rightPanel/types";

const GIT_TAB_ID = "git";

export type RightPanelRef = {
  openTerminal: (cwd: string) => void;
  openBrowser: (url?: string) => void;
  openFile: (filePath: string, fileName: string) => void;
};

type RightPanelProps = RightPanelContentProps & {
  isCollapsed: boolean;
  isFullscreen: boolean;
};

export const RightPanel = forwardRef<RightPanelRef, RightPanelProps>(
  ({ isCollapsed, isFullscreen, activeDirectory }, ref): React.JSX.Element => {
    const { t } = useI18n();
    const [tabs, setTabs] = useState<RightPanelTab[]>([
      { id: GIT_TAB_ID, type: "git", title: t("rightPanel.gitTab") },
    ]);
    const [activeTabId, setActiveTabId] = useState<string>(GIT_TAB_ID);
    const [dirtyTabs, setDirtyTabs] = useState<Set<string>>(new Set());

    const handleOpenDiffTab = useCallback<OpenDiffTabCallback>(
      (file, diffResult, diffLoading) => {
        const tabId = `diff:${file.path}`;
        setTabs((prev) => {
          const existing = prev.find((t) => t.id === tabId);
          if (existing) {
            return prev.map((t) =>
              t.id === tabId
                ? {
                    ...t,
                    data: {
                      filePath: file.path,
                      selectedFile: file,
                      diffResult,
                      diffLoading,
                    },
                  }
                : t
            );
          }
          const newTab: RightPanelTab = {
            id: tabId,
            type: "diff",
            title: file.path.split("/").pop() ?? file.path,
            data: {
              filePath: file.path,
              selectedFile: file,
              diffResult,
              diffLoading,
            },
          };
          return [...prev, newTab];
        });
        setActiveTabId(tabId);
      },
      []
    );

    const handleOpenTerminalTab = useCallback(
      (cwd: string) => {
        const tabId = `terminal-${Date.now()}`;
        const terminalData: TerminalTabData = { cwd };
        setTabs((prev) => [
          ...prev,
          {
            id: tabId,
            type: "terminal",
            title: t("rightPanel.terminalTab"),
            data: terminalData,
          },
        ]);
        setActiveTabId(tabId);
      },
      [t]
    );

    const handleTerminalTitleChange = useCallback(
      (tabId: string, title: string) => {
        setTabs((prev) =>
          prev.map((tab) => (tab.id === tabId ? { ...tab, title } : tab))
        );
      },
      []
    );

    const handleOpenBrowserTab = useCallback(
      (url?: string, requestedInstanceId?: string): string => {
        const instanceId =
          requestedInstanceId ??
          `browser-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const browserData: BrowserTabData = {
          instanceId,
          url: url ?? "",
        };
        setTabs((prev) => [
          ...prev,
          {
            id: instanceId,
            type: "browser",
            title: t("rightPanel.browserTab"),
            data: browserData,
          },
        ]);
        setActiveTabId(instanceId);
        return instanceId;
      },
      [t]
    );

    useBrowserMcpCommandBridge(handleOpenBrowserTab);

    const handleBrowserTitleChange = useCallback(
      (tabId: string, title: string) => {
        setTabs((prev) =>
          prev.map((tab) => (tab.id === tabId ? { ...tab, title } : tab))
        );
      },
      []
    );

    const handleOpenFileTab = useCallback(
      (filePath: string, fileName: string) => {
        const tabId = `file:${filePath}`;
        setTabs((prev) => {
          const existing = prev.find((t) => t.id === tabId);
          if (existing) {
            return prev;
          }
          const fileData: FileViewerTabData = {
            filePath,
            fileName,
            isSsh: false,
          };
          const newTab: RightPanelTab = {
            id: tabId,
            type: "file",
            title: fileName,
            data: fileData,
          };
          return [...prev, newTab];
        });
        setActiveTabId(tabId);
      },
      []
    );

    const handleOpenFileDiffPreviewTab = useCallback(
      (payload: OpenFileDiffPreviewPayload) => {
        const tabId = `file-diff-preview:${payload.filePath}`;
        const patch = generateComparePatch(
          payload.fileName,
          payload.oldContent,
          payload.newContent,
          payload.oldStartLine,
          payload.newStartLine
        );
        const data: FileDiffPreviewTabData = {
          fileName: payload.fileName,
          filePath: payload.filePath,
          patch,
          oldStartLine: payload.oldStartLine,
          newStartLine: payload.newStartLine,
          changeType: payload.changeType,
        };
        setTabs((prev) => {
          const existing = prev.find((t) => t.id === tabId);
          if (existing) {
            return prev.map((t) =>
              t.id === tabId ? { ...t, data } : t
            );
          }
          const newTab: RightPanelTab = {
            id: tabId,
            type: "file-diff-preview",
            title: payload.fileName,
            data,
          };
          return [...prev, newTab];
        });
        setActiveTabId(tabId);
        rightPanelEvents.emit("request-expand");
      },
      []
    );

    useEffect(() => {
      return rightPanelEvents.on(
        "open-file-diff-preview",
        handleOpenFileDiffPreviewTab
      );
    }, [handleOpenFileDiffPreviewTab]);

    useImperativeHandle(
      ref,
      () => ({
        openTerminal: (cwd: string) => {
          handleOpenTerminalTab(cwd);
        },
        openBrowser: (url?: string) => {
          handleOpenBrowserTab(url);
        },
        openFile: (filePath: string, fileName: string) => {
          handleOpenFileTab(filePath, fileName);
        },
      }),
      [handleOpenTerminalTab, handleOpenBrowserTab, handleOpenFileTab]
    );

    const handleCloseTab = useCallback((tabId: string) => {
      setTabs((prev) => {
        if (tabId === GIT_TAB_ID) {
          return prev;
        }
        const filtered = prev.filter((t) => t.id !== tabId);
        if (filtered.length === 0) {
          return prev;
        }
        return filtered;
      });
      setDirtyTabs((prev) => {
        if (!prev.has(tabId)) {
          return prev;
        }
        const next = new Set(prev);
        next.delete(tabId);
        return next;
      });
      setActiveTabId((currentActive) => {
        if (currentActive !== tabId) {
          return currentActive;
        }
        return GIT_TAB_ID;
      });
    }, []);

    const tabListRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      const el = tabListRef.current;
      if (!el) {
        return;
      }
      const onWheel = (e: WheelEvent) => {
        if (e.deltaY === 0) {
          return;
        }
        const canScroll = el.scrollWidth > el.clientWidth;
        if (!canScroll) {
          return;
        }
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      };
      el.addEventListener("wheel", onWheel, { passive: false });
      return () => el.removeEventListener("wheel", onWheel);
    }, [tabs.length]);

    const panelClasses = [
      "right-panel",
      isCollapsed ? "collapsed" : "",
      isFullscreen ? "fullscreen" : "",
    ]
      .filter(Boolean)
      .join(" ");

    const renderTabContent = (tab: RightPanelTab): React.ReactNode => {
      if (tab.type === "git") {
        return (
          <GitPanelContent
            activeDirectory={activeDirectory}
            onOpenInTab={handleOpenDiffTab}
          />
        );
      }

      if (tab.type === "terminal") {
        const terminalData = tab.data as TerminalTabData;
        return (
          <TerminalPanelContent
            cwd={terminalData.cwd}
            isActive={activeTabId === tab.id}
            onTitleChange={(title) => handleTerminalTitleChange(tab.id, title)}
          />
        );
      }

      if (tab.type === "browser") {
        const browserData = tab.data as BrowserTabData;
        return (
          <BrowserPanelContent
            instanceId={browserData.instanceId}
            initialUrl={browserData.url}
            isActive={activeTabId === tab.id}
            onTitleChange={(title) => handleBrowserTitleChange(tab.id, title)}
          />
        );
      }

      if (tab.type === "diff") {
        const diffData = tab.data as DiffTabData;
        if (!diffData) {
          return null;
        }
        return (
          <DiffViewer
            selectedFile={diffData.selectedFile}
            diffResult={diffData.diffResult}
            diffLoading={diffData.diffLoading}
          />
        );
      }

      if (tab.type === "file") {
        const fileData = tab.data as FileViewerTabData;
        if (!fileData) {
          return null;
        }
        return (
          <FileViewerContent
            filePath={fileData.filePath}
            fileName={fileData.fileName}
            isSsh={fileData.isSsh}
            sshSessionId={fileData.sshSessionId}
            onDirtyChange={(dirty) =>
              setDirtyTabs((prev) => {
                const next = new Set(prev);
                if (dirty) {
                  next.add(tab.id);
                } else {
                  next.delete(tab.id);
                }
                return next;
              })
            }
          />
        );
      }

      if (tab.type === "file-diff-preview") {
        const previewData = tab.data as FileDiffPreviewTabData;
        if (!previewData) {
          return null;
        }
        return (
          <FileDiffPreview
            diffs={[
              {
                path: previewData.filePath,
                changeType: previewData.changeType,
                content: previewData.patch ?? "",
                isBinary: false,
              },
            ]}
            isLoading={false}
            hasError={previewData.patch == null}
            labels={{
              loading: t("rightPanel.loadingDiff"),
              error: t("rightPanel.diffPreviewError"),
              empty: t("rightPanel.noChangesToDisplay"),
              selectFile: t("rightPanel.selectFileToViewDiff"),
            }}
          />
        );
      }

      return null;
    };

    return (
      <aside className={panelClasses}>
        {tabs.length > 1 && (
          <div className="right-panel-tabs">
            <div ref={tabListRef} className="right-panel-tab-list">
              {tabs.map((tab) => (
                <div
                  key={tab.id}
                  className={`right-panel-tab-item ${
                    activeTabId === tab.id ? "active" : ""
                  }`}
                  onClick={() => setActiveTabId(tab.id)}
                >
                  <span className="right-panel-tab-title" title={tab.title}>
                    {dirtyTabs.has(tab.id) && (
                      <span className="right-panel-tab-dirty-dot" aria-hidden="true" />
                    )}
                    {tab.title}
                  </span>
                  {tab.id !== GIT_TAB_ID && (
                    <button
                      type="button"
                      className="right-panel-tab-close"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCloseTab(tab.id);
                      }}
                      aria-label={t("rightPanel.closeTab")}
                    >
                      <X size={12} strokeWidth={1.8} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="right-panel-content-wrapper">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={`right-panel-tab-pane ${
                activeTabId === tab.id ? "active" : ""
              }`}
            >
              {renderTabContent(tab)}
            </div>
          ))}
        </div>
      </aside>
    );
  }
);

RightPanel.displayName = "RightPanel";
