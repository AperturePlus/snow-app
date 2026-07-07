import { useEffect } from "react";
import { ScrollbarManager } from "./scrollbarManager";

/**
 * Mounts the global overlay scrollbar manager.
 *
 * Call once at the app root — the manager scans the entire document
 * for scrollable elements and injects overlay thumbs automatically.
 */
export function useOverlayScrollbars(): void {
  useEffect(() => {
    const manager = new ScrollbarManager();
    manager.observe();
    return () => manager.disconnect();
  }, []);
}
