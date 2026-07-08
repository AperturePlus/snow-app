import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Loader2,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useI18n } from "../../i18n";
import { getFileTypeIcon } from "../../utils/fileIcons";
import type {
  DirectoryEntry,
  FileSearchResult,
  SshConnectParams,
} from "../../../preload";
import type { SidebarContentProps } from "./types";

type TreeNode = {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  children?: TreeNode[];
  loaded?: boolean;
  loading?: boolean;
};

type FlatNode = {
  node: TreeNode;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
};

const flattenTree = (
  nodes: TreeNode[],
  expandedPaths: Set<string>,
  depth = 0
): FlatNode[] => {
  const result: FlatNode[] = [];

  for (const node of nodes) {
    const isExpanded = expandedPaths.has(node.path);
    result.push({
      node,
      depth,
      hasChildren: node.isDirectory,
      isExpanded,
    });

    if (isExpanded && node.children) {
      result.push(...flattenTree(node.children, expandedPaths, depth + 1));
    }
  }

  return result;
};

const getFileIcon = (
  node: TreeNode,
  isExpanded: boolean
): React.JSX.Element => {
  return getFileTypeIcon(node.name, node.isDirectory, isExpanded, {
    className: "tree-icon",
    size: 14,
  });
};

const formatSize = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export function ProjectExplorerContent({
  onSwitchContent,
  onOpenFile,
  explorerDirectoryId,
}: SidebarContentProps): React.JSX.Element {
  const { t } = useI18n();
  const [rootPath, setRootPath] = useState<string | null>(null);
  const [rootName, setRootName] = useState("");
  const [isSsh, setIsSsh] = useState(false);
  const sshSessionIdRef = useRef<string | null>(null);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const treeRef = useRef<HTMLDivElement | null>(null);
  const treeStateRef = useRef<TreeNode[]>([]);
  const rootPathRef = useRef<string | null>(null);
  const loadChildrenRef = useRef<
    ((parentPath: string) => Promise<void>) | null
  >(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<FileSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchSeqRef = useRef(0);

  const loadRootDirectory = useCallback(async (): Promise<void> => {
    if (!explorerDirectoryId) {
      setError(
        t("sidebar.explorerNoActiveDirectory", {
          defaultValue: "No active workspace directory",
        })
      );
      setTree([]);
      setRootPath(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const directories = await window.snow.listWorkspaceDirectories();
      const targetDir = directories.find(
        (d) => d.directoryId === explorerDirectoryId
      );

      if (!targetDir) {
        setError(
          t("sidebar.explorerNoActiveDirectory", {
            defaultValue: "No active workspace directory",
          })
        );
        setTree([]);
        setRootPath(null);
        return;
      }

      setRootPath(targetDir.path);
      rootPathRef.current = targetDir.path;
      setRootName(targetDir.name);

      const sshDir = targetDir.path.startsWith("ssh://");
      setIsSsh(sshDir);

      if (sshDir) {
        const parsed = await window.snow.sshParseUrl(targetDir.path);
        const credential = await window.snow.sshGetCredential(
          parsed.host,
          parsed.port,
          parsed.username
        );

        const connectParams: SshConnectParams = {
          host: parsed.host,
          port: parsed.port,
          username: parsed.username,
          authMethod: credential?.authMethod ?? "password",
        };

        if (credential?.privateKeyPath) {
          connectParams.privateKeyPath = credential.privateKeyPath;
        }

        const secret = credential?.encryptedSecret
          ? await window.snow.sshGetDecryptedSecret(
              parsed.host,
              parsed.port,
              parsed.username
            )
          : null;

        if (secret) {
          if (connectParams.authMethod === "password") {
            connectParams.password = secret;
          } else {
            connectParams.passphrase = secret;
          }
        }

        const sessionId = await window.snow.sshConnect(connectParams);
        sshSessionIdRef.current = sessionId;

        const sshEntries = await window.snow.sshListDirectory(
          sessionId,
          parsed.remotePath
        );
        const nodes: TreeNode[] = sshEntries.map((entry) => ({
          name: entry.name,
          path: entry.path,
          isDirectory: entry.isDirectory,
          size: entry.size,
          loaded: !entry.isDirectory,
          loading: false,
        }));

        setTree(nodes);
      } else {
        const entries = await window.snow.readDirectoryEntries(targetDir.path);
        const nodes: TreeNode[] = entries.map((entry: DirectoryEntry) => ({
          name: entry.name,
          path: entry.path,
          isDirectory: entry.isDirectory,
          size: entry.size,
          loaded: !entry.isDirectory,
          loading: false,
        }));

        setTree(nodes);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("sidebar.explorerLoadError", {
              defaultValue: "Failed to load directory contents",
            })
      );
    } finally {
      setIsLoading(false);
    }
  }, [explorerDirectoryId, t]);

  useEffect(() => {
    setExpandedPaths(new Set());
    void loadRootDirectory();
  }, [loadRootDirectory]);

  const handleToggle = useCallback(
    async (nodePath: string): Promise<void> => {
      const isCurrentlyExpanded = expandedPaths.has(nodePath);

      if (isCurrentlyExpanded) {
        setExpandedPaths((prev) => {
          const next = new Set(prev);
          next.delete(nodePath);
          return next;
        });
        return;
      }

      setExpandedPaths((prev) => {
        const next = new Set(prev);
        next.add(nodePath);
        return next;
      });

      const findAndUpdateNode = (
        nodes: TreeNode[],
        targetPath: string
      ): TreeNode[] => {
        return nodes.map((node) => {
          if (node.path === targetPath) {
            if (node.loaded || node.loading) {
              return node;
            }

            void loadChildrenRef.current?.(node.path);
            return { ...node, loading: true };
          }

          if (node.children) {
            return {
              ...node,
              children: findAndUpdateNode(node.children, targetPath),
            };
          }

          return node;
        });
      };

      setTree((prev) => findAndUpdateNode(prev, nodePath));
    },
    [expandedPaths]
  );

  const loadChildren = useCallback(
    async (parentPath: string): Promise<void> => {
      try {
        let entries: DirectoryEntry[];
        if (isSsh && sshSessionIdRef.current) {
          const sshEntries = await window.snow.sshListDirectory(
            sshSessionIdRef.current,
            parentPath
          );
          entries = sshEntries;
        } else {
          entries = await window.snow.readDirectoryEntries(parentPath);
        }
        const childNodes: TreeNode[] = entries.map((entry: DirectoryEntry) => ({
          name: entry.name,
          path: entry.path,
          isDirectory: entry.isDirectory,
          size: entry.size,
          loaded: !entry.isDirectory,
          loading: false,
        }));

        setTree((prev) => {
          const updateNode = (nodes: TreeNode[]): TreeNode[] => {
            return nodes.map((node) => {
              if (node.path === parentPath) {
                return {
                  ...node,
                  children: childNodes,
                  loaded: true,
                  loading: false,
                };
              }

              if (node.children) {
                return {
                  ...node,
                  children: updateNode(node.children),
                };
              }

              return node;
            });
          };

          return updateNode(prev);
        });
      } catch {
        setTree((prev) => {
          const markError = (nodes: TreeNode[]): TreeNode[] => {
            return nodes.map((node) => {
              if (node.path === parentPath) {
                return { ...node, loading: false, loaded: true, children: [] };
              }

              if (node.children) {
                return {
                  ...node,
                  children: markError(node.children),
                };
              }

              return node;
            });
          };

          return markError(prev);
        });
      }
    },
    [isSsh]
  );

  // Keep loadChildrenRef in sync so handleToggle always calls the latest
  // version of loadChildren (which depends on isSsh and sshSessionIdRef).
  useEffect(() => {
    loadChildrenRef.current = loadChildren;
  }, [loadChildren]);

  const handleRefresh = useCallback((): void => {
    setExpandedPaths(new Set());
    void loadRootDirectory();
  }, [loadRootDirectory]);

  const handleBack = useCallback((): void => {
    onSwitchContent("main");
  }, [onSwitchContent]);

  const handleSearchChange = useCallback((value: string): void => {
    setSearchQuery(value);

    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
    }

    const trimmed = value.trim();

    if (!trimmed) {
      setIsSearching(false);
      setSearchResults([]);
      return;
    }

    setIsSearching(true);

    const seq = ++searchSeqRef.current;

    searchTimerRef.current = setTimeout(async () => {
      try {
        const results = await window.snow.searchFiles(
          rootPathRef.current ?? "",
          trimmed
        );
        // Only apply results from the latest search
        if (seq === searchSeqRef.current) {
          setSearchResults(results);
          setIsSearching(false);
        }
      } catch {
        if (seq === searchSeqRef.current) {
          setSearchResults([]);
          setIsSearching(false);
        }
      }
    }, 300);
  }, []);

  const handleClearSearch = useCallback((): void => {
    setSearchQuery("");
    setSearchResults([]);
    setIsSearching(false);
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
    }
  }, []);

  // Cleanup search timer on unmount
  useEffect(() => {
    return () => {
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current);
      }
    };
  }, []);

  const isSearchMode = searchQuery.trim().length > 0;

  const silentRefreshDirectory = useCallback(
    async (dirPath: string): Promise<void> => {
      try {
        const entries = await window.snow.readDirectoryEntries(dirPath);
        const childNodes: TreeNode[] = entries.map((entry: DirectoryEntry) => ({
          name: entry.name,
          path: entry.path,
          isDirectory: entry.isDirectory,
          size: entry.size,
          loaded: !entry.isDirectory,
          loading: false,
        }));

        setTree((prev) => {
          const mergeChildren = (nodes: TreeNode[]): TreeNode[] => {
            return nodes.map((node) => {
              if (node.path === dirPath) {
                if (!node.loaded) {
                  return node;
                }

                const oldChildren = node.children ?? [];
                return {
                  ...node,
                  children: childNodes.map((child) => {
                    const existing = oldChildren.find(
                      (old) => old.path === child.path
                    );
                    if (existing) {
                      return {
                        ...child,
                        children: existing.children,
                        loaded: existing.loaded,
                        loading: false,
                      };
                    }
                    return child;
                  }),
                  loaded: true,
                  loading: false,
                };
              }

              if (node.children) {
                return {
                  ...node,
                  children: mergeChildren(node.children),
                };
              }

              return node;
            });
          };

          return mergeChildren(prev);
        });
      } catch {
        // Silently ignore refresh errors
      }
    },
    []
  );

  const collectLoadedPaths = useCallback(
    (nodes: TreeNode[], current: Set<string> = new Set()): Set<string> => {
      for (const node of nodes) {
        if (node.isDirectory && node.loaded) {
          current.add(node.path);
        }
        if (node.children) {
          collectLoadedPaths(node.children, current);
        }
      }
      return current;
    },
    []
  );

  useEffect(() => {
    if (!rootPath) {
      return;
    }

    if (isSsh) {
      return;
    }

    void window.snow.startDirectoryWatch(rootPath);

    const unsubscribe = window.snow.onDirectoryChanged((_dirPath: string) => {
      const loadedPaths = collectLoadedPaths(treeStateRef.current);
      for (const path of loadedPaths) {
        void silentRefreshDirectory(path);
      }
    });

    return () => {
      unsubscribe();
      void window.snow.stopDirectoryWatch(rootPath);
    };
  }, [rootPath, isSsh, collectLoadedPaths, silentRefreshDirectory]);

  useEffect(() => {
    treeStateRef.current = tree;
  }, [tree]);

  useEffect(() => {
    return () => {
      if (sshSessionIdRef.current) {
        void window.snow.sshDisconnect(sshSessionIdRef.current);
        sshSessionIdRef.current = null;
      }
    };
  }, []);

  const flatNodes = useMemo(
    () => flattenTree(tree, expandedPaths),
    [tree, expandedPaths]
  );

  const handleTreeDragStart = useCallback(
    (event: React.DragEvent<HTMLDivElement>, node: TreeNode) => {
      event.dataTransfer.setData(
        "application/json",
        JSON.stringify({
          path: node.path,
          name: node.name,
          isDirectory: node.isDirectory,
        })
      );
      event.dataTransfer.effectAllowed = "copy";
    },
    []
  );

  const handleSearchResultDragStart = useCallback(
    (event: React.DragEvent<HTMLDivElement>, result: FileSearchResult) => {
      event.dataTransfer.setData(
        "application/json",
        JSON.stringify({
          path: result.path,
          name: result.name,
          isDirectory: false,
        })
      );
      event.dataTransfer.effectAllowed = "copy";
    },
    []
  );

  return (
    <>
      <div className="sidebar-content-header">
        <button
          className="icon-btn ghost"
          onClick={handleBack}
          type="button"
          aria-label={t("sidebar.explorerBack", {
            defaultValue: "Back to main sidebar",
          })}
        >
          <ArrowLeft size={16} strokeWidth={1.8} />
        </button>
        <span className="sidebar-content-title">
          {t("sidebar.explorerTitle", { defaultValue: "Explorer" })}
        </span>
        <button
          className="icon-btn ghost explorer-refresh-btn"
          onClick={handleRefresh}
          type="button"
          disabled={isLoading}
          aria-label={t("sidebar.explorerRefresh", {
            defaultValue: "Refresh",
          })}
        >
          {isLoading ? (
            <Loader2 className="spin" size={14} />
          ) : (
            <RefreshCw size={14} />
          )}
        </button>
      </div>

      <div className="explorer-content">
        {rootPath && !isSsh ? (
          <div className="explorer-search-bar">
            <Search size={13} strokeWidth={1.8} aria-hidden="true" />
            <input
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder={t("sidebar.explorerSearchPlaceholder", {
                defaultValue: "Search files and content",
              })}
              aria-label={t("sidebar.explorerSearchLabel", {
                defaultValue: "Search files",
              })}
              spellCheck={false}
            />
            {isSearching ? (
              <Loader2 className="spin" size={13} />
            ) : searchQuery ? (
              <button
                className="explorer-search-clear"
                onClick={handleClearSearch}
                type="button"
                aria-label={t("sidebar.explorerSearchClear", {
                  defaultValue: "Clear search",
                })}
              >
                <X size={13} />
              </button>
            ) : null}
          </div>
        ) : null}

        {rootPath ? (
          <div className="explorer-root-info">
            {getFileTypeIcon(rootName, true, true, { size: 13 })}
            <span className="explorer-root-name">{rootName}</span>
            <span className="explorer-root-path" title={rootPath}>
              {rootPath}
            </span>
          </div>
        ) : null}

        {error ? <span className="explorer-error">{error}</span> : null}

        {isSearchMode ? (
          <div className="explorer-tree" ref={treeRef}>
            {isSearching && searchResults.length === 0 ? (
              <span className="empty-text">
                {t("sidebar.explorerSearching", {
                  defaultValue: "Searching...",
                })}
              </span>
            ) : searchResults.length === 0 ? (
              <span className="empty-text">
                {t("sidebar.explorerNoSearchResults", {
                  defaultValue: "No results found",
                })}
              </span>
            ) : (
              <>
                <span className="explorer-search-count">
                  {t("sidebar.explorerSearchResultCount", {
                    defaultValue: "{{count}} results",
                    values: { count: searchResults.length },
                  })}
                </span>
                {searchResults.map((result) => (
                  <div
                    className="explorer-search-result"
                    key={result.path}
                    draggable
                    onDragStart={(event) =>
                      handleSearchResultDragStart(event, result)
                    }
                    onClick={() => {
                      setSelectedPath(result.path);
                      onOpenFile?.(result.path, result.name);
                    }}
                    title={result.path}
                  >
                    {getFileTypeIcon(result.name, false, false, {
                      className: "tree-icon",
                      size: 13,
                    })}
                    <div className="explorer-search-result-info">
                      <span className="explorer-search-result-name">
                        {result.name}
                      </span>
                      <span className="explorer-search-result-path">
                        {result.relativePath}
                      </span>
                      {result.lineMatches.map((match) => (
                        <span
                          className="explorer-search-result-line"
                          key={match.line}
                        >
                          <span className="explorer-search-line-number">
                            {match.line}
                          </span>
                          {match.text}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        ) : (
          <>
            {!error && !isLoading && tree.length === 0 ? (
              <span className="empty-text">
                {t("sidebar.explorerEmpty", {
                  defaultValue: "No files to display",
                })}
              </span>
            ) : null}

            <div className="explorer-tree" ref={treeRef}>
              {flatNodes.map((flatNode, index) => {
                const { node, depth, hasChildren, isExpanded } = flatNode;
                const isSelected = selectedPath === node.path;
                const isLast = index === flatNodes.length - 1;

                return (
                  <div
                    className={`explorer-tree-row${
                      isSelected ? " selected" : ""
                    }`}
                    key={node.path}
                    draggable
                    onDragStart={(event) => handleTreeDragStart(event, node)}
                    onClick={() => {
                      setSelectedPath(node.path);
                      if (hasChildren) {
                        void handleToggle(node.path);
                      } else {
                        onOpenFile?.(node.path, node.name);
                      }
                    }}
                    style={{ paddingLeft: `${depth * 14 + 8}px` }}
                    title={node.path}
                  >
                    <span className="explorer-tree-chevron">
                      {hasChildren ? (
                        isExpanded ? (
                          <ChevronDown size={13} />
                        ) : (
                          <ChevronRight size={13} />
                        )
                      ) : null}
                    </span>
                    {getFileIcon(node, isExpanded)}
                    <span className="explorer-tree-label">{node.name}</span>
                    {!node.isDirectory ? (
                      <span className="explorer-tree-size">
                        {formatSize(node.size)}
                      </span>
                    ) : node.loading ? (
                      <Loader2
                        className="spin explorer-tree-loading"
                        size={11}
                      />
                    ) : null}
                    {isLast ? null : null}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </>
  );
}
