import { useEffect } from "react";

/**
 * Global scrollbar auto-hide hook for Electron (Chromium).
 *
 * Makes scrollbars behave like macOS overlay scrollbars:
 * - Hidden by default
 * - Visible while scrolling
 * - Visible when hovering the scrollbar track area (the ~10px strip on the
 *   right or bottom edge), not just the thumb itself
 *
 * Works via event delegation on `document` — no per-element setup needed.
 * Toggles a `.sb-visible` CSS class on each scrollable element.
 */
export function useScrollbarAutoHide(): void {
  useEffect(() => {
    const SB_SIZE = 10; // must match ::-webkit-scrollbar width/height
    const FADE_DELAY = 600; // ms to keep visible after scroll/hover ends

    const scrollTimers = new WeakMap<HTMLElement, number>();
    const hoverElements = new Set<HTMLElement>();

    function show(el: HTMLElement): void {
      el.classList.add("sb-visible");
    }

    function hide(el: HTMLElement): void {
      el.classList.remove("sb-visible");
    }

    function scheduleHide(el: HTMLElement): void {
      const existing = scrollTimers.get(el);
      if (existing) clearTimeout(existing);
      const timer = window.setTimeout(() => {
        scrollTimers.delete(el);
        if (!hoverElements.has(el)) hide(el);
      }, FADE_DELAY);
      scrollTimers.set(el, timer);
    }

    /** Check whether point (x,y) falls inside the scrollbar strip of `el`. */
    function isInSbZone(el: HTMLElement, x: number, y: number): boolean {
      const rect = el.getBoundingClientRect();
      const scrollableY = el.scrollHeight > el.clientHeight + 1;
      const scrollableX = el.scrollWidth > el.clientWidth + 1;

      if (scrollableY) {
        // vertical scrollbar on the right edge
        if (
          x >= rect.right - SB_SIZE &&
          x <= rect.right &&
          y >= rect.top &&
          y <= rect.bottom
        ) {
          return true;
        }
      }
      if (scrollableX) {
        // horizontal scrollbar on the bottom edge
        if (
          y >= rect.bottom - SB_SIZE &&
          y <= rect.bottom &&
          x >= rect.left &&
          x <= rect.right
        ) {
          return true;
        }
      }
      return false;
    }

    // --- scroll listener (capture — scroll events don't bubble) ---
    function onScroll(e: Event): void {
      const el = e.target;
      if (el === document || !(el instanceof HTMLElement)) return;
      show(el);
      scheduleHide(el);
    }

    // --- mousemove listener (throttled via rAF) ---
    let rafId = 0;
    let lastX = 0;
    let lastY = 0;

    function onMouseMove(e: MouseEvent): void {
      lastX = e.clientX;
      lastY = e.clientY;
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        checkHover(lastX, lastY);
      });
    }

    function checkHover(x: number, y: number): void {
      const el = document.elementFromPoint(x, y) as HTMLElement | null;
      if (!el) return;

      // Walk up the tree — the mouse may be over a child of a scroll container
      let current: HTMLElement | null = el;
      const newHover = new Set<HTMLElement>();

      while (current) {
        const scrollableY = current.scrollHeight > current.clientHeight + 1;
        const scrollableX = current.scrollWidth > current.clientWidth + 1;
        if ((scrollableY || scrollableX) && isInSbZone(current, x, y)) {
          newHover.add(current);
          show(current);
        }
        current = current.parentElement;
      }

      // Remove hover for elements no longer in the scrollbar zone
      for (const old of hoverElements) {
        if (!newHover.has(old)) {
          hoverElements.delete(old);
          if (!scrollTimers.has(old)) hide(old);
        }
      }

      // Register newly hovered elements
      for (const item of newHover) hoverElements.add(item);
    }

    // Clear all hover state when the mouse leaves the window
    function onMouseLeave(): void {
      for (const el of hoverElements) {
        if (!scrollTimers.has(el)) hide(el);
      }
      hoverElements.clear();
    }

    document.addEventListener("scroll", onScroll, true);
    document.addEventListener("mousemove", onMouseMove, { passive: true });
    document.addEventListener("mouseleave", onMouseLeave);

    return () => {
      document.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseleave", onMouseLeave);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);
}
