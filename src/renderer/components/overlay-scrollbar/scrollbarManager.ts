import {
  OverlayScrollbars,
  type OverlayScrollbars as OverlayScrollbarsInstance,
  type PartialOptions,
} from "overlayscrollbars";

const INITIALIZE_ATTR = "data-overlayscrollbars-initialize";
const THEME_NAME = "os-theme-snow";

const SCROLLBAR_OPTIONS: PartialOptions = {
  scrollbars: {
    theme: THEME_NAME,
    visibility: "auto",
    autoHide: "move",
    autoHideDelay: 600,
    autoHideSuspend: false,
    dragScroll: true,
    clickScroll: false,
    pointers: ["mouse", "touch", "pen"],
  },
};

const INTERNAL_ELEMENT_SELECTOR = [
  ".os-scrollbar",
  ".os-scrollbar-track",
  ".os-scrollbar-handle",
  ".os-size-observer",
  ".os-size-observer-listener",
  ".os-size-observer-listener-item",
  ".os-trinsic-observer",
  "[data-overlayscrollbars-padding]",
  "[data-overlayscrollbars-content]",
].join(",");

const isScrollableOverflow = (overflow: string): boolean =>
  overflow === "auto" || overflow === "scroll";

/**
 * Global OverlayScrollbars manager.
 *
 * OverlayScrollbars is initialized per element, while this app historically
 * expects one root hook to cover all scrollable renderer elements. This small
 * manager keeps that global behavior, but delegates scrollbar rendering,
 * dragging, auto-hide and dynamic size handling to the third-party package.
 */
export class ScrollbarManager {
  private instances = new Map<HTMLElement, OverlayScrollbarsInstance>();
  private ro: ResizeObserver | null = null;
  private mo: MutationObserver | null = null;
  private scanScheduled = false;
  private disposed = false;

  observe(): void {
    this.disposed = false;
    this.ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target instanceof HTMLElement) {
          this.instances.get(entry.target)?.update();
        }
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
    window.addEventListener("resize", this.onWindowResize);
  }

  disconnect(): void {
    this.disposed = true;
    this.ro?.disconnect();
    this.mo?.disconnect();
    this.ro = null;
    this.mo = null;
    window.removeEventListener("resize", this.onWindowResize);

    for (const [host, instance] of this.instances) {
      this.destroyInstance(host, instance);
    }
    this.instances.clear();
  }

  private scheduleScan(): void {
    if (this.scanScheduled || this.disposed) return;

    this.scanScheduled = true;
    requestAnimationFrame(() => {
      this.scanScheduled = false;
      if (!this.disposed) {
        this.scanAndAttach();
      }
    });
  }

  private scanAndAttach(): void {
    const all = document.querySelectorAll("*");

    for (const node of all) {
      if (!(node instanceof HTMLElement)) continue;
      if (!this.shouldAttach(node)) continue;
      this.attach(node);
    }

    for (const [host, instance] of this.instances) {
      if (!host.isConnected) {
        this.destroyInstance(host, instance);
        this.instances.delete(host);
        continue;
      }

      instance.update();
    }
  }

  private shouldAttach(host: HTMLElement): boolean {
    if (this.instances.has(host)) return false;
    if (host === document.body || host === document.documentElement)
      return false;
    if (!host.isConnected) return false;
    if (this.isOverlayScrollbarsInternalElement(host)) return false;
    if (OverlayScrollbars(host)) return false;
    // OverlayScrollbars restructures the host DOM, which breaks
    // contentEditable input handling — skip those elements entirely.
    if (host.isContentEditable) return false;

    const style = getComputedStyle(host);
    return (
      isScrollableOverflow(style.overflowY) ||
      isScrollableOverflow(style.overflowX)
    );
  }

  private isOverlayScrollbarsInternalElement(element: HTMLElement): boolean {
    return (
      element.matches(INTERNAL_ELEMENT_SELECTOR) ||
      Boolean(
        element.closest(".os-scrollbar,.os-size-observer,.os-trinsic-observer")
      )
    );
  }

  private attach(host: HTMLElement): void {
    host.setAttribute(INITIALIZE_ATTR, "");

    const instance =
      host instanceof HTMLTextAreaElement
        ? OverlayScrollbars(host, SCROLLBAR_OPTIONS)
        : OverlayScrollbars(
            {
              target: host,
              elements: {
                viewport: host,
                padding: false,
                content: false,
              },
              cancel: {
                nativeScrollbarsOverlaid: false,
                body: true,
              },
            },
            SCROLLBAR_OPTIONS
          );

    this.instances.set(host, instance);
    this.ro?.observe(host);
    instance.update(true);
  }

  private destroyInstance(
    host: HTMLElement,
    instance: OverlayScrollbarsInstance
  ): void {
    this.ro?.unobserve(host);

    if (OverlayScrollbars.valid(instance)) {
      instance.destroy();
    }

    host.removeAttribute(INITIALIZE_ATTR);
  }

  private onWindowResize = (): void => {
    for (const instance of this.instances.values()) {
      instance.update();
    }
    this.scheduleScan();
  };
}
