import { useLayoutEffect, useState } from "react";

export type DropdownDirection = "up" | "down";

const DROPDOWN_ESTIMATE_HEIGHT = 320;
const DROPDOWN_GAP = 6;

/**
 * Measures available vertical space around a trigger element and decides
 * whether a dropdown should open downward (preferred) or upward.
 *
 * @param containerRef - ref to the positioning container (position: relative wrapper)
 * @param isOpen - whether the dropdown is currently open
 * @returns direction "down" or "up"
 */
export const useDropdownDirection = (
  containerRef: React.RefObject<HTMLElement | null>,
  isOpen: boolean
): DropdownDirection => {
  const [direction, setDirection] = useState<DropdownDirection>("up");

  useLayoutEffect(() => {
    if (!isOpen) {
      return;
    }

    const el = containerRef.current;
    if (!el) {
      return;
    }

    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;

    // Prefer downward when there is enough space; otherwise flip up
    if (spaceBelow >= DROPDOWN_ESTIMATE_HEIGHT + DROPDOWN_GAP) {
      setDirection("down");
    } else if (spaceAbove >= DROPDOWN_ESTIMATE_HEIGHT + DROPDOWN_GAP) {
      setDirection("up");
    } else {
      // Not enough space on either side — pick the larger one
      setDirection(spaceBelow >= spaceAbove ? "down" : "up");
    }
  }, [containerRef, isOpen]);

  return direction;
};
