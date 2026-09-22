'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

/** Breathing room between the menu and the edge of the window. */
const GUTTER = 12;
/** Below this a downward menu is not worth opening — flip it instead. */
const WORTH_FLIPPING = 160;
/** However cramped the window is, the menu still gets this much and scrolls. */
const FLOOR = 96;

export type MenuPlacementOptions = {
  /** How tall the menu is allowed to get before the window gets a say. */
  maxHeight?: number;
  /** The gap between the trigger and the menu. */
  offset?: number;
  /** Close the menu: called on a click outside it, and on Escape. Leaving it
   *  out keeps the menu open until the caller closes it some other way. */
  onDismiss?: () => void;
};

/**
 * Open a dropdown downwards, or upwards when that is where the room is.
 *
 * A row menu anchored to the last row of a long list ran off the bottom of the
 * window: the items were rendered, just not reachable. The trigger's own
 * position is the only input that matters — the menu is placed against whichever
 * side of it has more space, and capped to what that side actually has, so the
 * worst case is a menu that scrolls rather than one that is cut off.
 *
 * Usage: attach `anchorRef` to the positioned (`position: relative`) wrapper the
 * menu is absolutely placed inside, and spread `menuStyle` over that menu's own
 * style — it carries `top` or `bottom`, never both. `open` may be a boolean or
 * the id of the open row; screens that keep one menu open at a time can hold a
 * single hook and hand the ref to whichever row is currently showing one.
 */
export function useMenuPlacement<T extends HTMLElement = HTMLDivElement>(
  open: unknown = true,
  options: MenuPlacementOptions = {},
) {
  const { maxHeight = 320, offset = 4, onDismiss } = options;
  const anchorRef = useRef<T | null>(null);
  /* Held in a ref so an inline `() => setOpen(null)` does not resubscribe the
     listeners on every render of the screen behind the menu. */
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({ top: `calc(100% + ${offset}px)`, maxHeight, overflow: 'auto' });

  const measure = useCallback(() => {
    const node = anchorRef.current;
    if (!node || typeof window === 'undefined') return;
    const rect = node.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - offset - GUTTER;
    const above = rect.top - offset - GUTTER;
    /* Down is the default and stays the default while it is usable: a menu that
       jumps sides on a small scroll is worse than a slightly short one. */
    const flip = below < Math.min(maxHeight, WORTH_FLIPPING) && above > below;
    const room = Math.max(FLOOR, Math.floor(flip ? above : below));
    setMenuStyle({
      [flip ? 'bottom' : 'top']: `calc(100% + ${offset}px)`,
      maxHeight: Math.min(maxHeight, room),
      overflow: 'auto',
    });
  }, [maxHeight, offset]);

  useLayoutEffect(() => {
    if (!open) return;
    measure();
    /* The window can move under an open menu — a scroll on the list behind it,
       a resize, a rail being dragged. `true` because the scroll that matters is
       usually an inner container's, and those do not bubble. */
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open, measure]);

  /* Dismissal, matching the notification tray: a click outside, or Escape.
     Without both, the menu sits over whatever the user reaches for next.
     `mousedown` rather than `click`, so the menu is gone before the thing
     underneath it reacts — and the anchor wraps the trigger as well as the
     menu, so the trigger's own click is left to toggle as it always did. */
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      const node = anchorRef.current;
      if (node && event.target instanceof Node && node.contains(event.target)) return;
      dismiss.current?.();
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss.current?.(); };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return { anchorRef, menuStyle };
}
