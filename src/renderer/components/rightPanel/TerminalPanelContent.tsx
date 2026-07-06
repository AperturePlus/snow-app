import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import type { ITheme } from "@xterm/xterm";
import { useEffect, useRef } from "react";

export type TerminalPanelContentProps = {
  cwd: string;
  isActive: boolean;
  onTitleChange?: (title: string) => void;
};

const darkTerminalTheme: ITheme = {
  background: "#0E0E0E",
  foreground: "#e0e0e0",
  cursor: "#e0e0e0",
  selectionBackground: "rgba(255, 255, 255, 0.18)",
};

const lightTerminalTheme: ITheme = {
  background: "#FBFCFD",
  foreground: "#333333",
  cursor: "#333333",
  selectionBackground: "rgba(0, 0, 0, 0.12)",
};

const getTerminalTheme = (): ITheme => {
  if (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  ) {
    return darkTerminalTheme;
  }
  return lightTerminalTheme;
};

export const TerminalPanelContent = ({
  cwd,
  isActive,
  onTitleChange,
}: TerminalPanelContentProps): React.JSX.Element => {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const ptyIdRef = useRef<string | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    let disposed = false;
    let resizeObserver: ResizeObserver | null = null;
    let disposeOutput: (() => void) | null = null;
    let disposeExit: (() => void) | null = null;
    let exited = false;

    const term = new Terminal({
      fontFamily:
        "'SF Mono', 'Menlo', 'Consolas', 'Liberation Mono', monospace",
      fontSize: 13,
      cursorBlink: true,
      theme: getTerminalTheme(),
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);

    // Synchronously fit so PTY is created with correct cols/rows.
    // Without this, initPty() reads default 80x24 dimensions, the PTY
    // starts with wrong size, and the subsequent resize causes zsh to
    // emit PROMPT_EOL_MARK (%) at the end of the prompt line.
    try {
      fit.fit();
    } catch {
      // ignore
    }

    if (disposed) {
      term.dispose();
      return;
    }

    termRef.current = term;
    fitRef.current = fit;

    resizeObserver = new ResizeObserver(() => {
      if (!disposed) {
        try {
          fit.fit();
        } catch {
          // ignore
        }
      }
    });
    resizeObserver.observe(containerRef.current);

    const darkModeMedia = window.matchMedia("(prefers-color-scheme: dark)");
    const handleThemeChange = (): void => {
      if (!disposed) {
        term.options.theme = getTerminalTheme();
      }
    };
    darkModeMedia.addEventListener("change", handleThemeChange);

    const initPty = async () => {
      try {
        const cols = term.cols > 0 ? term.cols : 80;
        const rows = term.rows > 0 ? term.rows : 24;
        const id = await window.snow.ptyCreate({ cwd, cols, rows });
        if (disposed) {
          void window.snow.ptyKill(id);
          return;
        }
        ptyIdRef.current = id;

        disposeOutput = window.snow.onPtyOutput((payload) => {
          if (payload.id === id && !disposed) {
            term.write(payload.data);
          }
        });

        disposeExit = window.snow.onPtyExit((payload) => {
          if (payload.id === id && !disposed) {
            exited = true;
            term.write("\r\n\x1b[90m[Process exited]\x1b[0m\r\n");
            disposeOutput?.();
            disposeExit?.();
          }
        });

        term.onData((data) => {
          if (!exited && ptyIdRef.current) {
            void window.snow.ptyWrite(id, data);
          }
        });

        term.onResize(({ cols, rows }) => {
          if (!exited && ptyIdRef.current) {
            void window.snow.ptyResize(id, cols, rows);
          }
        });

        term.onTitleChange((title) => {
          if (!disposed && onTitleChange) {
            onTitleChange(title);
          }
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("Failed to initialize PTY:", err);
      }
    };

    void initPty();

    cleanupRef.current = () => {
      disposed = true;
      resizeObserver?.disconnect();
      darkModeMedia.removeEventListener("change", handleThemeChange);
      disposeOutput?.();
      disposeExit?.();
      if (ptyIdRef.current) {
        void window.snow.ptyKill(ptyIdRef.current);
        ptyIdRef.current = null;
      }
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };

    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd]);

  useEffect(() => {
    if (!isActive || !termRef.current || !fitRef.current) {
      return;
    }
    const raf = requestAnimationFrame(() => {
      try {
        fitRef.current?.fit();
        termRef.current?.focus();
      } catch {
        // ignore
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [isActive]);

  return (
    <div className="terminal-panel">
      <div
        ref={containerRef}
        className="terminal-container"
        style={{
          width: "100%",
          height: "100%",
          minHeight: "200px",
        }}
      />
    </div>
  );
};
