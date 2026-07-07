import { ArrowDown, ArrowUp, Check, File, Folder, Loader2 } from "lucide-react";
import {
  forwardRef,
  useImperativeHandle,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import type {
  FileSearchResult,
  WorkspaceDirectoryRecord,
} from "../../../../preload";
import { useI18n } from "../../../i18n";
import type { FileTag } from "./fileTagUtils";

export type FileMentionPopupHandle = {
  handleKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => boolean;
};

export type FileMentionPopupProps = {
  visible: boolean;
  query: string;
  onClose: () => void;
  onSelect: (tag: FileTag) => void;
  onSelectBatch: (tags: FileTag[]) => void;
  textareaRef: RefObject<HTMLDivElement | null>;
  onDragStart?: (event: React.DragEvent<HTMLDivElement>, tag: FileTag) => void;
};

const toFileTag = (entry: FileSearchResult): FileTag => ({
  path: entry.path,
  name: entry.name,
  isDirectory: entry.isDirectory,
});

const sortResults = (
  results: FileSearchResult[],
  queryLower: string,
  endsWithSlash: boolean
): FileSearchResult[] => {
  return results.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1;
    }
    if (endsWithSlash) {
      return a.name.localeCompare(b.name);
    }
    const aExact = a.name.toLowerCase() === queryLower;
    const bExact = b.name.toLowerCase() === queryLower;
    if (aExact !== bExact) {
      return aExact ? -1 : 1;
    }
    const aStarts = a.name.toLowerCase().startsWith(queryLower);
    const bStarts = b.name.toLowerCase().startsWith(queryLower);
    if (aStarts !== bStarts) {
      return aStarts ? -1 : 1;
    }
    const aNameMatch = a.matchedName ? 0 : 1;
    const bNameMatch = b.matchedName ? 0 : 1;
    if (aNameMatch !== bNameMatch) {
      return aNameMatch - bNameMatch;
    }
    return a.name.localeCompare(b.name);
  });
};

export const FileMentionPopup = forwardRef<
  FileMentionPopupHandle,
  FileMentionPopupProps
>(function FileMentionPopup(
  {
    visible,
    query,
    onClose,
    onSelect,
    onSelectBatch,
    textareaRef,
    onDragStart,
  },
  ref
): React.JSX.Element | null {
  const { t } = useI18n();
  const [activeDirectory, setActiveDirectory] =
    useState<WorkspaceDirectoryRecord | null>(null);
  const [entries, setEntries] = useState<FileSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingInitial, setIsLoadingInitial] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [checkedPaths, setCheckedPaths] = useState<Set<string>>(new Set());

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchSeqRef = useRef(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const lastQueryRef = useRef("");
  const preloadedEntriesRef = useRef<FileSearchResult[]>([]);

  const preloadRootEntries = useCallback(
    async (dir: WorkspaceDirectoryRecord) => {
      try {
        const rawEntries = await window.snow.readDirectoryEntries(dir.path);
        const results: FileSearchResult[] = rawEntries
          .filter((e) => !e.name.startsWith("."))
          .slice(0, 50)
          .map((e) => ({
            path: e.path,
            relativePath: e.path.replace(dir.path + "/", ""),
            name: e.name,
            isDirectory: e.isDirectory,
            matchedName: true,
            lineMatches: [],
          }));
        preloadedEntriesRef.current = results;
        setEntries(results);
        setSelectedIndex(0);
        setIsLoadingInitial(false);
      } catch {
        preloadedEntriesRef.current = [];
        setEntries([]);
        setIsLoadingInitial(false);
      }
    },
    []
  );

  const loadDirectories = useCallback(async () => {
    try {
      const dirs = await window.snow.listWorkspaceDirectories();
      const active = dirs.find((d) => d.isActive) ?? dirs[0] ?? null;
      setActiveDirectory(active);
      if (active) {
        await preloadRootEntries(active);
      } else {
        setIsLoadingInitial(false);
      }
    } catch {
      setActiveDirectory(null);
      setIsLoadingInitial(false);
    }
  }, [preloadRootEntries]);

  useEffect(() => {
    if (visible) {
      setIsLoadingInitial(true);
      preloadedEntriesRef.current = [];
      void loadDirectories();
      setEntries([]);
      setSelectedIndex(0);
      setCheckedPaths(new Set());
      lastQueryRef.current = "";
    }
  }, [visible, loadDirectories]);

  useEffect(() => {
    if (!visible) {
      return;
    }

    const trimmed = query.trim();

    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
    }

    if (!trimmed || !activeDirectory) {
      setIsSearching(false);
      if (preloadedEntriesRef.current.length > 0) {
        setEntries(preloadedEntriesRef.current);
        setSelectedIndex(0);
      }
      lastQueryRef.current = "";
      return;
    }

    if (trimmed === lastQueryRef.current) {
      return;
    }
    lastQueryRef.current = trimmed;

    setIsSearching(true);
    const seq = ++searchSeqRef.current;

    searchTimerRef.current = setTimeout(async () => {
      if (seq !== searchSeqRef.current) {
        return;
      }

      const queryLower = trimmed.toLowerCase();
      const endsWithSlash = queryLower.endsWith("/");

      try {
        let results: FileSearchResult[] = [];

        if (endsWithSlash) {
          const dirName = trimmed.slice(0, -1).trim();
          if (dirName) {
            try {
              const searchResults = await window.snow.searchFiles(
                activeDirectory.path,
                dirName
              );
              const dirMatch = searchResults.find(
                (r) =>
                  r.isDirectory &&
                  r.name.toLowerCase() === dirName.toLowerCase()
              );
              const targetPath =
                dirMatch?.path ??
                searchResults.find((r) => r.isDirectory && r.matchedName)?.path;
              if (targetPath) {
                const rawEntries = await window.snow.readDirectoryEntries(
                  targetPath
                );
                results = rawEntries
                  .filter((e) => !e.name.startsWith("."))
                  .map((e) => ({
                    path: e.path,
                    relativePath: e.path.replace(
                      activeDirectory.path + "/",
                      ""
                    ),
                    name: e.name,
                    isDirectory: e.isDirectory,
                    matchedName: true,
                    lineMatches: [],
                  }));
              }
            } catch {
              /* empty */
            }
          }
        } else {
          results = await window.snow.searchFiles(
            activeDirectory.path,
            trimmed
          );
        }

        if (seq !== searchSeqRef.current) {
          return;
        }

        setEntries(sortResults(results, queryLower, endsWithSlash));
        setIsSearching(false);
        setSelectedIndex(0);
      } catch {
        if (seq === searchSeqRef.current) {
          setEntries([]);
          setIsSearching(false);
        }
      }
    }, 150);

    return () => {
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current);
      }
    };
  }, [visible, query, activeDirectory]);

  const toggleCheck = useCallback((entry: FileSearchResult) => {
    setCheckedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(entry.path)) {
        next.delete(entry.path);
      } else {
        next.add(entry.path);
      }
      return next;
    });
  }, []);

  const handleSelectEntry = useCallback(
    (entry: FileSearchResult) => {
      const checkedEntries = entries.filter((e) => checkedPaths.has(e.path));
      if (checkedEntries.length > 0 && !checkedPaths.has(entry.path)) {
        onSelectBatch([...checkedEntries.map(toFileTag), toFileTag(entry)]);
      } else if (checkedPaths.has(entry.path)) {
        onSelectBatch(checkedEntries.map(toFileTag));
      } else {
        onSelect(toFileTag(entry));
      }
      onClose();
    },
    [entries, checkedPaths, onSelect, onSelectBatch, onClose]
  );

  const handleConfirmSelection = useCallback(() => {
    const checkedEntries = entries.filter((e) => checkedPaths.has(e.path));
    if (checkedEntries.length > 0) {
      onSelectBatch(checkedEntries.map(toFileTag));
      onClose();
    } else if (entries[selectedIndex]) {
      onSelect(toFileTag(entries[selectedIndex]));
      onClose();
    }
  }, [entries, checkedPaths, selectedIndex, onSelect, onSelectBatch, onClose]);

  useImperativeHandle(
    ref,
    () => ({
      handleKeyDown: (event: React.KeyboardEvent<HTMLDivElement>): boolean => {
        const nativeEvent = event.nativeEvent;
        const isComposing =
          nativeEvent.isComposing ||
          (nativeEvent as unknown as { keyCode?: number }).keyCode === 229;

        if (isComposing) {
          return false;
        }

        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
          return true;
        }

        if (entries.length === 0) {
          return false;
        }

        if (event.key === "ArrowDown") {
          event.preventDefault();
          setSelectedIndex((prev) =>
            prev < entries.length - 1 ? prev + 1 : prev
          );
          return true;
        }

        if (event.key === "ArrowUp") {
          event.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : 0));
          return true;
        }

        if (event.key === " ") {
          event.preventDefault();
          if (entries[selectedIndex]) {
            toggleCheck(entries[selectedIndex]);
          }
          return true;
        }

        if (event.key === "Enter") {
          event.preventDefault();
          handleConfirmSelection();
          return true;
        }

        return false;
      },
    }),
    [entries, selectedIndex, toggleCheck, handleConfirmSelection, onClose]
  );

  useEffect(() => {
    if (!selectedIndex) {
      return;
    }
    const container = listRef.current;
    if (!container) {
      return;
    }
    const selected = container.querySelector<HTMLElement>(
      `[data-mention-index="${selectedIndex}"]`
    );
    if (selected) {
      selected.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  useEffect(() => {
    if (!visible) {
      return;
    }
    const handleDocumentPointerDown = (event: MouseEvent) => {
      if (
        popupRef.current &&
        !popupRef.current.contains(event.target as Node) &&
        textareaRef.current &&
        !textareaRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleDocumentPointerDown);
    return () => {
      document.removeEventListener("mousedown", handleDocumentPointerDown);
    };
  }, [visible, onClose, textareaRef]);

  const handleEntryDragStart = useCallback(
    (event: React.DragEvent<HTMLDivElement>, entry: FileSearchResult) => {
      const tag = toFileTag(entry);
      if (onDragStart) {
        onDragStart(event, tag);
      } else {
        event.dataTransfer.setData("application/json", JSON.stringify(tag));
        event.dataTransfer.effectAllowed = "copy";
      }
    },
    [onDragStart]
  );

  const emptyText = useMemo(() => {
    if (isSearching) {
      return t("fileMention.searching");
    }
    if (query && entries.length === 0) {
      return t("fileMention.noResults");
    }
    return t("fileMention.typeToSearch");
  }, [isSearching, query, entries.length, t]);

  if (!visible) {
    return null;
  }

  return (
    <div className="file-mention-popup" ref={popupRef}>
      <div className="file-mention-list" ref={listRef}>
        {isLoadingInitial ? (
          <div className="file-mention-skeleton">
            {Array.from({ length: 6 }, (_, i) => (
              <div className="mention-skeleton-item" key={i}>
                <div className="mention-skeleton-icon" />
                <div className="mention-skeleton-line" />
              </div>
            ))}
            <div className="file-mention-empty">
              <Loader2 className="spin" size={14} />
              <span>{t("fileMention.loading")}</span>
            </div>
          </div>
        ) : isSearching && entries.length === 0 ? (
          <div className="file-mention-empty">
            <Loader2 className="spin" size={14} />
            <span>{emptyText}</span>
          </div>
        ) : entries.length === 0 ? (
          <div className="file-mention-empty">
            <span>{emptyText}</span>
          </div>
        ) : (
          <>
            {(isSearching || entries.length > 0) && (
              <span className="file-mention-count">
                {isSearching && <Loader2 className="spin" size={11} />}
                {entries.length > 0 &&
                  t("fileMention.results", {
                    values: { count: entries.length },
                  })}
                {entries.length > 0 &&
                  checkedPaths.size > 0 &&
                  ` | ${t("fileMention.selected", {
                    values: { count: checkedPaths.size },
                  })}`}
              </span>
            )}
            {entries.map((entry, index) => {
              const isChecked = checkedPaths.has(entry.path);
              const isSelected = selectedIndex === index;
              return (
                <div
                  key={entry.path}
                  data-mention-index={index}
                  className={`mention-entry ${isSelected ? "selected" : ""} ${
                    isChecked ? "checked" : ""
                  }`}
                  draggable
                  onDragStart={(e) => handleEntryDragStart(e, entry)}
                  onClick={() => handleSelectEntry(entry)}
                  title={entry.path}
                >
                  <span className="mention-entry-check">
                    {isChecked && <Check size={13} />}
                  </span>
                  {entry.isDirectory ? (
                    <Folder size={14} className="mention-entry-icon" />
                  ) : (
                    <File size={14} className="mention-entry-icon" />
                  )}
                  <span className="mention-entry-name">{entry.name}</span>
                  {entry.relativePath && (
                    <span className="mention-entry-path">
                      {entry.relativePath}
                    </span>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>

      <div className="file-mention-footer">
        <span className="file-mention-hint">
          <kbd className="mention-kbd-icon">
            <ArrowUp size={10} />
          </kbd>
          <kbd className="mention-kbd-icon">
            <ArrowDown size={10} />
          </kbd>{" "}
          {t("fileMention.navigate")}
        </span>
        <span className="file-mention-hint">
          <kbd>Space</kbd> {t("fileMention.check")}
        </span>
        <span className="file-mention-hint">
          <kbd>Enter</kbd> {t("fileMention.confirm")}
        </span>
        <span className="file-mention-hint">
          <kbd>Esc</kbd> {t("fileMention.close")}
        </span>
        <span className="file-mention-hint drag-hint">
          {t("fileMention.dragToInput")}
        </span>
      </div>
    </div>
  );
});
