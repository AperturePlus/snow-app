/**
 * Custom overlay scrollbar manager for Electron (Chromium).
 *
 * Hides native scrollbars completely (scrollbar-width: none) so they
 * no longer occupy space in the document flow, then injects lightweight
 * DOM-based overlay thumb elements that float on top of content.
 *
 * Features:
 * - Auto-hide (visible while scrolling / hovering over the scroll container)
 * - Drag-to-scroll via pointer events
 * - Dynamic content detection (MutationObserver + ResizeObserver)
 * - Vertical and horizontal scrollbars
 * - CSS-variable theming via --scrollbar-thumb / hover / active
 */

const MIN_THUMB = 36;
const TRACK_SIZE = 10;
const FADE_MS = 600;

interface Instance {
  host: HTMLElement;
  vTrack: HTMLElement;
  vThumb: HTMLElement;
  hTrack: HTMLElement;
  hThumb: HTMLElement;
  hideTimer: number | null;
  isDraggingV: boolean;
  isDraggingH: boolean;
  dragStartY: number;
  dragStartScrollTop: number;
  dragStartX: number;
  dragStartScrollLeft: number;
  /** Original inline position value, restored on detach. */
  forcedRelative: boolean;
}

export class ScrollbarManager {
  private instances = new Map<HTMLElement, Instance>();
  private pending = new Set<Instance>();
  private rafId = 0;
  private ro: ResizeObserver | null = null;
  private mo: MutationObserver | null = null;
  private scanScheduled = false;
  private mouseRaf = 0;
  private lastMouseX = 0;
  private lastMouseY = 0;
  private dragInst: Instance | null = null;
  private dragOrientation: "vertical" | "horizontal" | null = null;

  // ===== public API =====

  observe(): void {
    this.ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const inst = this.instances.get(entry.target as HTMLElement);
        if (inst) this.requestUpdate(inst);
      }
      this.scheduleScan();
    });

    this.mo = new MutationObserver(() => this.scheduleScan());
    this.mo.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "class"],
    });

    this.scheduleScan();

    document.addEventListener("scroll", this.onScroll, true);
    window.addEventListener("resize", this.onWindowResize);
    window.addEventListener("scroll", this.onWindowScroll, true);
    document.addEventListener("mousemove", this.onMouseMove, { passive: true });
    document.addEventListener("mouseleave", this.onMouseLeave);
  }

  disconnect(): void {
    this.ro?.disconnect();
    this.mo?.disconnect();
    document.removeEventListener("scroll", this.onScroll, true);
    window.removeEventListener("resize", this.onWindowResize);
    window.removeEventListener("scroll", this.onWindowScroll, true);
    document.removeEventListener("mousemove", this.onMouseMove);
    document.removeEventListener("mouseleave", this.onMouseLeave);
    document.removeEventListener("pointermove", this.onPointerMove);
    document.removeEventListener("pointerup", this.onPointerUp);
    if (this.rafId) cancelAnimationFrame(this.rafId);
    if (this.mouseRaf) cancelAnimationFrame(this.mouseRaf);

    for (const inst of this.instances.values()) {
      this.detach(inst);
    }
    this.instances.clear();
  }

  // ===== scan & attach =====

  private scheduleScan(): void {
    if (this.scanScheduled) return;
    this.scanScheduled = true;
    requestAnimationFrame(() => {
      this.scanScheduled = false;
      this.scanAndAttach();
    });
  }

  private scanAndAttach(): void {
    const all = document.querySelectorAll<HTMLElement>("*");
    const current = new Set<HTMLElement>();

    for (const el of all) {
      if (el === document.body || el === document.documentElement) continue;
      if (!el.isConnected) continue;

      const cs = getComputedStyle(el);
      const oy = cs.overflowY;
      const ox = cs.overflowX;
      if (
        oy !== "auto" &&
        oy !== "scroll" &&
        ox !== "auto" &&
        ox !== "scroll"
      ) {
        continue;
      }

      current.add(el);
      if (!this.instances.has(el)) {
        this.attach(el);
      }
      this.requestUpdate(this.instances.get(el)!);
    }

    // detach hosts that disappeared or lost overflow
    for (const [el, inst] of this.instances) {
      if (!current.has(el)) {
        this.detach(inst);
        this.instances.delete(el);
      }
    }
  }

  private attach(host: HTMLElement): void {
    const vTrack = document.createElement("div");
    vTrack.className = "os-track os-vertical";
    const vThumb = document.createElement("div");
    vThumb.className = "os-thumb";
    vTrack.appendChild(vThumb);

    const hTrack = document.createElement("div");
    hTrack.className = "os-track os-horizontal";
    const hThumb = document.createElement("div");
    hThumb.className = "os-thumb";
    hTrack.appendChild(hThumb);

    host.appendChild(vTrack);
    host.appendChild(hTrack);

    let forcedRelative = false;
    if (getComputedStyle(host).position === "static") {
      forcedRelative = true;
      host.style.position = "relative";
    }

    const inst: Instance = {
      host,
      vTrack,
      vThumb,
      hTrack,
      hThumb,
      hideTimer: null,
      isDraggingV: false,
      isDraggingH: false,
      dragStartY: 0,
      dragStartScrollTop: 0,
      dragStartX: 0,
      dragStartScrollLeft: 0,
      forcedRelative,
    };

    vThumb.addEventListener("pointerdown", (e) =>
      this.onThumbDown(e, inst, "vertical")
    );
    hThumb.addEventListener("pointerdown", (e) =>
      this.onThumbDown(e, inst, "horizontal")
    );

    this.instances.set(host, inst);
    this.ro?.observe(host);
  }

  private detach(inst: Instance): void {
    if (inst.hideTimer) clearTimeout(inst.hideTimer);
    this.ro?.unobserve(inst.host);
    inst.vTrack.remove();
    inst.hTrack.remove();
    if (inst.forcedRelative) {
      inst.host.style.position = "";
    }
  }

  // ===== update =====

  private requestUpdate(inst: Instance): void {
    this.pending.add(inst);
    if (this.rafId) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0;
      const set = this.pending;
      this.pending = new Set();
      for (const i of set) this.update(i);
    });
  }

  private update(inst: Instance): void {
    const { host, vTrack, vThumb, hTrack, hThumb } = inst;
    const rect = host.getBoundingClientRect();

    if (rect.width === 0 || rect.height === 0) {
      vTrack.style.display = "none";
      hTrack.style.display = "none";
      return;
    }

    const {
      scrollTop,
      scrollHeight,
      clientHeight,
      scrollLeft,
      scrollWidth,
      clientWidth,
    } = host;
    const canV = scrollHeight > clientHeight + 1;
    const canH = scrollWidth > clientWidth + 1;

    // --- vertical ---
    if (canV) {
      vTrack.style.display = "";
      // When both scrollbars are visible, leave room for the horizontal
      // track at the bottom so they don't overlap at the corner.
      const trackH = canH ? clientHeight - TRACK_SIZE : clientHeight;
      vTrack.style.height = `${trackH}px`;
      // translateX(scrollLeft) counteracts horizontal scrolling so the
      // track stays pinned to the right edge of the visible viewport.
      vTrack.style.transform = `translate(${scrollLeft}px, ${scrollTop}px)`;

      const thumbH = Math.max(
        MIN_THUMB,
        (clientHeight / scrollHeight) * trackH
      );
      const maxTop = scrollHeight - clientHeight;
      const thumbY = maxTop > 0 ? (scrollTop / maxTop) * (trackH - thumbH) : 0;
      vThumb.style.height = `${thumbH}px`;
      vThumb.style.transform = `translateY(${thumbY}px)`;
    } else {
      vTrack.style.display = "none";
    }

    // --- horizontal ---
    if (canH) {
      hTrack.style.display = "";
      // When both scrollbars are visible, leave room for the vertical
      // track on the right so they don't overlap at the corner.
      const trackW = canV ? clientWidth - TRACK_SIZE : clientWidth;
      hTrack.style.width = `${trackW}px`;
      hTrack.style.transform = `translate(${scrollLeft}px, ${
        scrollTop + clientHeight - TRACK_SIZE
      }px)`;

      const thumbW = Math.max(MIN_THUMB, (clientWidth / scrollWidth) * trackW);
      const maxLeft = scrollWidth - clientWidth;
      const thumbX =
        maxLeft > 0 ? (scrollLeft / maxLeft) * (trackW - thumbW) : 0;
      hThumb.style.width = `${thumbW}px`;
      hThumb.style.transform = `translateX(${thumbX}px)`;
    } else {
      hTrack.style.display = "none";
    }
  }

  // ===== visibility =====

  private show(inst: Instance): void {
    inst.vTrack.classList.add("os-visible");
    inst.hTrack.classList.add("os-visible");
  }

  private hide(inst: Instance): void {
    if (inst.isDraggingV || inst.isDraggingH) return;
    inst.vTrack.classList.remove("os-visible");
    inst.hTrack.classList.remove("os-visible");
  }

  private scheduleHide(inst: Instance): void {
    if (inst.isDraggingV || inst.isDraggingH) return;
    if (inst.hideTimer) clearTimeout(inst.hideTimer);
    inst.hideTimer = window.setTimeout(() => {
      inst.hideTimer = null;
      this.hide(inst);
    }, FADE_MS);
  }

  // ===== event handlers =====

  private onScroll = (e: Event): void => {
    const t = e.target;
    if (t === document || !(t instanceof HTMLElement)) return;
    const inst = this.instances.get(t);
    if (!inst) return;
    // Synchronous update — no rAF deferral so the thumb tracks
    // the scroll position without a 1-frame visual lag.
    this.update(inst);
    this.show(inst);
    const r = inst.host.getBoundingClientRect();
    const mouseOver =
      this.lastMouseX >= r.left &&
      this.lastMouseX <= r.right &&
      this.lastMouseY >= r.top &&
      this.lastMouseY <= r.bottom;
    if (!mouseOver) {
      this.scheduleHide(inst);
    }
  };

  /** Window-level scroll (reposition overlays when viewport shifts). */
  private onWindowScroll = (): void => {
    // Synchronous update so overlays track viewport shifts without lag.
    for (const inst of this.instances.values()) {
      this.update(inst);
    }
  };

  private onWindowResize = (): void => {
    for (const inst of this.instances.values()) {
      this.requestUpdate(inst);
    }
  };

  private onMouseMove = (e: MouseEvent): void => {
    this.lastMouseX = e.clientX;
    this.lastMouseY = e.clientY;
    if (this.mouseRaf) return;
    this.mouseRaf = requestAnimationFrame(() => {
      this.mouseRaf = 0;
      this.checkHover(this.lastMouseX, this.lastMouseY);
    });
  };

  private checkHover(x: number, y: number): void {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    if (!el) return;

    let node: HTMLElement | null = el;
    const newHover = new Set<Instance>();

    while (node) {
      const inst = this.instances.get(node);
      if (inst) {
        const r = node.getBoundingClientRect();
        const inside =
          x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
        if (inside) {
          newHover.add(inst);
          this.show(inst);
        }
      }
      node = node.parentElement;
    }

    for (const inst of this.instances.values()) {
      if (!newHover.has(inst) && !inst.hideTimer) {
        this.hide(inst);
      }
    }
  }

  private onMouseLeave = (): void => {
    for (const inst of this.instances.values()) {
      if (!inst.hideTimer) this.hide(inst);
    }
  };

  // ===== drag =====

  private onThumbDown(
    e: PointerEvent,
    inst: Instance,
    orientation: "vertical" | "horizontal"
  ): void {
    e.preventDefault();
    e.stopPropagation();
    this.dragInst = inst;
    this.dragOrientation = orientation;

    if (orientation === "vertical") {
      inst.isDraggingV = true;
      inst.dragStartY = e.clientY;
      inst.dragStartScrollTop = inst.host.scrollTop;
    } else {
      inst.isDraggingH = true;
      inst.dragStartX = e.clientX;
      inst.dragStartScrollLeft = inst.host.scrollLeft;
    }

    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    document.addEventListener("pointermove", this.onPointerMove);
    document.addEventListener("pointerup", this.onPointerUp);
    this.show(inst);
  }

  private onPointerMove = (e: PointerEvent): void => {
    const inst = this.dragInst;
    const orient = this.dragOrientation;
    if (!inst || !orient) return;

    if (orient === "vertical") {
      const dy = e.clientY - inst.dragStartY;
      const { scrollHeight, clientHeight } = inst.host;
      const r = inst.host.getBoundingClientRect();
      const thumbH = Math.max(
        MIN_THUMB,
        (clientHeight / scrollHeight) * r.height
      );
      const trackRange = r.height - thumbH;
      if (trackRange <= 0) return;
      const maxScroll = scrollHeight - clientHeight;
      inst.host.scrollTop = Math.max(
        0,
        Math.min(
          maxScroll,
          inst.dragStartScrollTop + (dy / trackRange) * maxScroll
        )
      );
    } else {
      const dx = e.clientX - inst.dragStartX;
      const { scrollWidth, clientWidth } = inst.host;
      const r = inst.host.getBoundingClientRect();
      const thumbW = Math.max(MIN_THUMB, (clientWidth / scrollWidth) * r.width);
      const trackRange = r.width - thumbW;
      if (trackRange <= 0) return;
      const maxScroll = scrollWidth - clientWidth;
      inst.host.scrollLeft = Math.max(
        0,
        Math.min(
          maxScroll,
          inst.dragStartScrollLeft + (dx / trackRange) * maxScroll
        )
      );
    }

    // Synchronous update during drag — avoid rAF delay so the thumb
    // stays glued to the pointer position while dragging.
    this.update(inst);
  };

  private onPointerUp = (): void => {
    const inst = this.dragInst;
    if (!inst) return;
    inst.isDraggingV = false;
    inst.isDraggingH = false;
    this.dragInst = null;
    this.dragOrientation = null;
    document.removeEventListener("pointermove", this.onPointerMove);
    document.removeEventListener("pointerup", this.onPointerUp);
    this.scheduleHide(inst);
  };
}
