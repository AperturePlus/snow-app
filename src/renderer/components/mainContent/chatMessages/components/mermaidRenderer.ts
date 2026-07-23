/**
 * Mermaid diagram renderer (main-thread only).
 *
 * Mermaid needs DOM access, so it cannot run inside the markdown Web Worker.
 * The worker emits placeholder containers (`.mermaid-block[data-mermaid]`)
 * carrying the escaped diagram source. This module lazily imports mermaid and
 * renders each placeholder into an SVG, with:
 *
 * - A two-phase render cycle: synchronous cache injection (via useLayoutEffect)
 *   prevents flash on re-render, while async rendering handles uncached sources.
 * - Failure-tolerant streaming: when mermaid.parse fails on incomplete code
 *   during streaming, the error is silently ignored — the code view stays
 *   visible and the render is retried on the next content update. No error
 *   states are shown, eliminating flicker.
 * - A render cache keyed by source string (theme-tagged) so finalized diagrams
 *   are not re-parsed on every React re-render.
 * - Theme awareness: re-renders all visible diagrams when the global
 *   `data-theme` attribute changes (light <-> dark).
 * - Code/diagram view toggle with per-source preference tracking.
 */

/** Selector for placeholder containers emitted by the worker. */
const MERMAID_SELECTOR = ".mermaid-block[data-mermaid]";

/** Attribute set on a placeholder once it has been rendered for a given theme. */
const RENDERED_ATTR = "data-mermaid-rendered";

/** Attribute controlling which view (code/diagram) is visible. */
const VIEW_ATTR = "data-mermaid-view";

const isDarkTheme = (): boolean =>
  document.documentElement.getAttribute("data-theme") === "dark";

const currentThemeKey = (): string => (isDarkTheme() ? "dark" : "light");

// ---------------------------------------------------------------------------
// SVG render cache
// ---------------------------------------------------------------------------

/** Cache entry: the rendered SVG and the theme it was rendered for. */
type CacheEntry = { svg: string; theme: string };

const svgCache = new Map<string, CacheEntry>();

const cacheSet = (key: string, value: CacheEntry): void => {
  if (svgCache.size >= 64) {
    const oldest = svgCache.keys().next().value;
    if (oldest !== undefined) svgCache.delete(oldest);
  }
  svgCache.set(key, value);
};

// ---------------------------------------------------------------------------
// View preference tracking (survives innerHTML replacement)
// ---------------------------------------------------------------------------

/**
 * Per-source view preference. When the user explicitly chooses "code", we
 * respect that choice even after a successful render. Keyed by source string.
 */
const viewPreferences = new Map<string, "code" | "diagram">();

// ---------------------------------------------------------------------------
// Mermaid lazy import
// ---------------------------------------------------------------------------

let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;
let initializedTheme: string | null = null;

const getMermaid = async (): Promise<typeof import("mermaid").default> => {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((mod) => {
      const mermaid = mod.default;
      const theme = currentThemeKey();
      mermaid.initialize({
        startOnLoad: false,
        theme: theme === "dark" ? "dark" : "default",
        securityLevel: "strict",
        fontFamily: "inherit",
      });
      initializedTheme = theme;
      return mermaid;
    });
  }
  return mermaidPromise;
};

const ensureTheme = async (
  mermaid: typeof import("mermaid").default
): Promise<void> => {
  const theme = currentThemeKey();
  if (initializedTheme !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      theme: theme === "dark" ? "dark" : "default",
      securityLevel: "strict",
      fontFamily: "inherit",
    });
    initializedTheme = theme;
  }
};

// ---------------------------------------------------------------------------
// Render coordination
// ---------------------------------------------------------------------------

let renderIdCounter = 0;

/**
 * Token used to cancel stale render batches. When a new batch starts, the
 * token is incremented; in-flight batches check the token and abort if stale.
 */
let currentRenderToken = 0;

/**
 * Apply the cached SVG (if any) to a single block and set the view mode.
 * Returns true if a cache hit was applied.
 */
const applyCache = (
  block: HTMLElement,
  source: string,
  themeKey: string
): boolean => {
  const entry = svgCache.get(source);
  if (!entry || entry.theme !== themeKey) return false;

  const diagramView = block.querySelector<HTMLElement>(".mermaid-view-diagram");
  if (diagramView) {
    diagramView.innerHTML = entry.svg;
  }
  block.setAttribute(RENDERED_ATTR, themeKey);

  const pref = viewPreferences.get(source) ?? "diagram";
  block.setAttribute(VIEW_ATTR, pref);
  return true;
};

/**
 * Synchronously inject cached SVGs into all mermaid placeholders within `root`.
 *
 * Call this from useLayoutEffect (before browser paint) so that already-rendered
 * diagrams appear instantly after innerHTML replacement — no flash.
 */
export const injectCachedDiagrams = (root: ParentNode): void => {
  const blocks = root.querySelectorAll<HTMLElement>(MERMAID_SELECTOR);
  if (blocks.length === 0) return;

  const themeKey = currentThemeKey();
  blocks.forEach((block) => {
    const source = decodeURIComponent(block.getAttribute("data-mermaid") ?? "");
    applyCache(block, source, themeKey);
  });
};

/**
 * Asynchronously render uncached mermaid blocks.
 *
 * On failure (incomplete code during streaming, syntax errors, etc.) the error
 * is silently ignored — no error state is shown, no DOM is replaced. The code
 * view remains visible and the render is retried when content changes.
 */
export const renderMermaidBlocks = async (root: ParentNode): Promise<void> => {
  const blocks = root.querySelectorAll<HTMLElement>(MERMAID_SELECTOR);
  if (blocks.length === 0) return;

  const themeKey = currentThemeKey();
  const token = ++currentRenderToken;

  const pending: { block: HTMLElement; source: string }[] = [];

  blocks.forEach((block) => {
    // Skip blocks already rendered for this theme (cache-injected or
    // previously rendered by an earlier async batch).
    if (block.getAttribute(RENDERED_ATTR) === themeKey) return;

    const source = decodeURIComponent(block.getAttribute("data-mermaid") ?? "");

    // Late cache hit (e.g. another instance rendered the same source).
    if (applyCache(block, source, themeKey)) return;

    pending.push({ block, source });
  });

  if (pending.length === 0) return;

  const mermaid = await getMermaid();
  await ensureTheme(mermaid);

  for (const { block, source } of pending) {
    // Abort if a newer render batch started.
    if (token !== currentRenderToken) return;
    if (!block.isConnected) continue;

    const id = `mmd-${renderIdCounter++}`;
    try {
      const { svg } = await mermaid.render(id, source);

      // Stale / detached checks after async.
      if (token !== currentRenderToken) return;
      if (!block.isConnected) {
        document.getElementById(id)?.remove();
        continue;
      }

      // Cache the successful result.
      cacheSet(source, { svg, theme: themeKey });

      // Inject into diagram view.
      const diagramView = block.querySelector<HTMLElement>(
        ".mermaid-view-diagram"
      );
      if (diagramView) {
        diagramView.innerHTML = svg;
      }
      block.setAttribute(RENDERED_ATTR, themeKey);

      // Auto-switch to diagram view (unless user prefers code).
      const pref = viewPreferences.get(source);
      if (pref !== "code") {
        block.setAttribute(VIEW_ATTR, "diagram");
      }
    } catch {
      // Render failed — likely incomplete mermaid code during streaming.
      // Do NOT cache, do NOT replace DOM, do NOT show error.
      // The code view remains visible. We'll retry on the next content
      // update when the source changes.
      // Clean up any stray elements mermaid may have created on failure.
      document.getElementById(id)?.remove();
    }
  }
};

// ---------------------------------------------------------------------------
// View toggle
// ---------------------------------------------------------------------------

/**
 * Toggle a mermaid block between code and diagram views.
 * Stores the preference so it survives innerHTML replacement.
 *
 * Switching to "diagram" is rejected if the SVG hasn't been rendered yet.
 */
export const setMermaidView = (
  block: HTMLElement,
  view: "code" | "diagram"
): void => {
  if (view === "diagram" && !block.hasAttribute(RENDERED_ATTR)) return;

  const source = decodeURIComponent(block.getAttribute("data-mermaid") ?? "");
  viewPreferences.set(source, view);
  block.setAttribute(VIEW_ATTR, view);
};

// ---------------------------------------------------------------------------
// Export (save as SVG / PNG / JPG)
// ---------------------------------------------------------------------------

/** Supported export formats. */
export type MermaidExportFormat = "svg" | "png" | "jpg";

/** Default pixel scale for raster exports (2x for retina-quality output). */
const EXPORT_SCALE = 2;
/** Background fill for JPG (opaque) and PNG (when the SVG has none). */
const EXPORT_BG = isDarkTheme() ? "#1a1a1a" : "#ffffff";

/**
 * Extract the `<svg>` element rendered inside a mermaid block's diagram view.
 * Returns null if the diagram has not been rendered yet.
 */
const getBlockSvg = (block: HTMLElement): SVGSVGElement | null => {
  const diagramView = block.querySelector<HTMLElement>(".mermaid-view-diagram");
  if (!diagramView) return null;
  return diagramView.querySelector("svg");
};

/** Serialize an SVG element to a standalone XML string with XML declaration. */
const serializeSvg = (svg: SVGSVGElement): string => {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  // Ensure xmlns is present so the file is self-contained.
  if (!clone.getAttribute("xmlns")) {
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
};

/** Trigger a browser download for a Blob with the given filename. */
const downloadBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the download has time to start.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/** Save a file using the native file picker when available, falling back to download. */
const saveFile = async (
  blob: Blob,
  filename: string,
  mimeTypes: string[]
): Promise<void> => {
  // showSaveFilePicker is available in Electron (Chromium-based) and modern browsers.
  const picker = (
    window as unknown as {
      showSaveFilePicker?: (opts: {
        suggestedName?: string;
        types: { description?: string; accept: Record<string, string[]> }[];
      }) => Promise<FileSystemFileHandle>;
    }
  ).showSaveFilePicker;

  if (typeof picker === "function") {
    try {
      const handle = await picker({
        suggestedName: filename,
        types: [
          {
            description: "Image file",
            accept: { [mimeTypes[0]]: mimeTypes },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch {
      // User cancelled the picker or the write failed — fall back to download.
    }
  }
  downloadBlob(blob, filename);
};

/**
 * Get the natural (intrinsic) dimensions of an SVG element from its viewBox.
 *
 * Mermaid SVGs carry a `viewBox` that represents the true vector bounds. The
 * `width`/`height` attributes are often set to the rendered (possibly
 * CSS-constrained) display size and may be inaccurate (e.g. a horizontal
 * flowchart shown at a small width with `max-width:100%`). Using viewBox as
 * the authoritative source ensures the exported raster matches the real
 * aspect ratio and full resolution.
 */
const getSvgDimensions = (
  svg: SVGSVGElement
): { width: number; height: number } => {
  const viewBox = svg.viewBox.baseVal;
  if (viewBox && viewBox.width > 0 && viewBox.height > 0) {
    return { width: viewBox.width, height: viewBox.height };
  }

  // Fallback: bounding client rect (CSS layout size).
  const rect = svg.getBoundingClientRect();
  const width = rect.width || svg.clientWidth || 0;
  const height = rect.height || svg.clientHeight || 0;
  return { width: Math.max(width, 1), height: Math.max(height, 1) };
};

/**
 * Build a standalone SVG string with explicit width/height so that when loaded
 * into an Image element it renders at its natural vector resolution — not the
 * possibly CSS-constrained display size.
 */
const serializeSvgForRaster = (svg: SVGSVGElement): string => {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const { width, height } = getSvgDimensions(svg);

  if (!clone.getAttribute("xmlns")) {
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  }
  // Force explicit pixel dimensions and remove any CSS that might constrain
  // the rendered size (e.g. max-width:100%, width:auto).
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  clone.removeAttribute("style");

  return new XMLSerializer().serializeToString(clone);
};

/** Rasterize an SVG element to a canvas at the given format and scale. */
const rasterizeSvg = (
  svg: SVGSVGElement,
  format: "png" | "jpg",
  scale: number
): Promise<HTMLCanvasElement> => {
  const { width, height } = getSvgDimensions(svg);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get 2D canvas context");

  // Fill background for JPG (no transparency support) and as a fallback for PNG.
  if (format === "jpg") {
    ctx.fillStyle = EXPORT_BG;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // Use a data: URL instead of a blob: URL — the app's CSP allows img-src
  // data: but not blob:. Encoding the SVG as base64 keeps it CSP-compliant.
  const svgString = serializeSvgForRaster(svg);
  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`;

  return new Promise<HTMLCanvasElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      // Draw at the canvas's pixel dimensions, preserving the SVG aspect ratio.
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas);
    };
    img.onerror = () => {
      reject(new Error("Failed to load SVG into image"));
    };
    img.src = dataUrl;
  });
};

/**
 * Export a mermaid block's diagram to the specified format and save it.
 *
 * SVG is saved as-is. PNG/JPG are rasterized at 2x scale for crisp output.
 * The diagram must have been rendered (SVG present) before calling this.
 */
export const exportMermaid = async (
  block: HTMLElement,
  format: MermaidExportFormat,
  baseName = "mermaid-diagram"
): Promise<void> => {
  const svg = getBlockSvg(block);
  if (!svg) return;

  if (format === "svg") {
    const svgString = serializeSvg(svg);
    const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
    await saveFile(blob, `${baseName}.svg`, ["image/svg+xml"]);
    return;
  }

  const canvas = await rasterizeSvg(svg, format, EXPORT_SCALE);
  const mime = format === "png" ? "image/png" : "image/jpeg";
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, mime, 0.95)
  );
  if (!blob) return;
  await saveFile(blob, `${baseName}.${format}`, [mime]);
};

// ---------------------------------------------------------------------------
// Export menu (dropdown for format selection)
// ---------------------------------------------------------------------------

/**
 * Open a small dropdown menu anchored to `anchorEl` with SVG / PNG / JPG options.
 * The menu is positioned absolutely and dismissed on outside click or escape.
 *
 * Returns nothing — the caller does not need to manage the menu lifecycle; it
 * self-cleans up on close.
 */
export const openExportMenu = (
  anchorEl: HTMLElement,
  block: HTMLElement
): void => {
  // Remove any existing export menu first.
  document.querySelectorAll(".mermaid-export-menu").forEach((el) => el.remove());

  const menu = document.createElement("div");
  menu.className = "mermaid-export-menu";

  const formats: { format: MermaidExportFormat; label: string }[] = [
    { format: "svg", label: "SVG" },
    { format: "png", label: "PNG" },
    { format: "jpg", label: "JPG" },
  ];

  for (const { format, label } of formats) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "mermaid-export-menu-item";
    item.textContent = label;
    item.addEventListener("click", () => {
      menu.remove();
      void exportMermaid(block, format);
    });
    menu.appendChild(item);
  }

  // Position the menu below the anchor button.
  const rect = anchorEl.getBoundingClientRect();
  menu.style.position = "fixed";
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.left = `${rect.right}px`;
  menu.style.transform = "translateX(-100%)";

  document.body.appendChild(menu);

  // Dismiss handlers — added after a microtask so the opening click does not
  // immediately close the menu.
  const dismiss = (e: MouseEvent): void => {
    if (menu.contains(e.target as Node)) return;
    menu.remove();
    document.removeEventListener("mousedown", dismiss, true);
    document.removeEventListener("keydown", onKey, true);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      menu.remove();
      document.removeEventListener("mousedown", dismiss, true);
      document.removeEventListener("keydown", onKey, true);
    }
  };

  setTimeout(() => {
    document.addEventListener("mousedown", dismiss, true);
    document.addEventListener("keydown", onKey, true);
  }, 0);
};

// ---------------------------------------------------------------------------
// Theme change handling
// ---------------------------------------------------------------------------

/**
 * Re-render all mermaid diagrams in the document after a theme change.
 * Clears the rendered state so all blocks are re-processed for the new theme.
 */
export const refreshAllMermaidOnThemeChange = async (): Promise<void> => {
  // Clear rendered state on all blocks.
  document.querySelectorAll<HTMLElement>(MERMAID_SELECTOR).forEach((block) => {
    block.removeAttribute(RENDERED_ATTR);
  });

  // Inject from cache (entries matching the new theme, if any).
  injectCachedDiagrams(document);

  // Re-render uncached blocks for the new theme.
  await renderMermaidBlocks(document);
};

/**
 * Attach a one-time MutationObserver that watches the global `data-theme`
 * attribute and re-renders all diagrams when it flips between light/dark.
 *
 * Returns a cleanup function. Safe to call multiple times — only the first
 * call attaches the observer.
 */
let themeObserverAttached = false;

export const watchThemeForMermaid = (): (() => void) => {
  if (themeObserverAttached) return () => undefined;
  themeObserverAttached = true;

  const observer = new MutationObserver(() => {
    void refreshAllMermaidOnThemeChange();
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });

  return () => {
    observer.disconnect();
    themeObserverAttached = false;
  };
};
