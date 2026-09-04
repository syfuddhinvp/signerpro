'use client';

import { useEffect, useRef } from 'react';

/* ───────────────────────────────────────────────────────────────────────────
   The behaviour a `role="dialog"` element has to have to be one.

   Declaring `aria-modal="true"` claims all of this; the attribute alone
   provides none of it. Extracted from the in-app `Modals` host so the public
   signing route — the one legally operative screen in the product, and the one
   that had the attributes and none of the behaviour — can share it rather than
   reimplement it a fifth time.

     1 · focus moves into the dialog on open
     2 · Escape closes it
     3 · Tab cycles within it and cannot reach the page behind
     4 · the background is inert to assistive tech while it is up
     5 · focus returns to whatever opened it

   The background is made inert by walking the ancestor chain and hiding every
   off-path sibling, rather than by portalling the dialog out, so the dialog
   stays exactly where it renders.
   ─────────────────────────────────────────────────────────────────────────── */

const SELECTOR = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])', 'canvas[tabindex]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Wire modal behaviour onto a dialog element.
 *
 * @param open  whether the dialog is currently rendered
 * @param onClose  called on Escape; must be stable (useCallback)
 * @returns a ref to put on the `role="dialog"` element
 */
export function useModalBehaviour<T extends HTMLElement = HTMLDivElement>(
  open: boolean,
  onClose: () => void,
) {
  const dialogRef = useRef<T | null>(null);

  useEffect(() => {
    if (!open) return;
    const root = dialogRef.current;
    if (!root) return;

    const opener = document.activeElement as HTMLElement | null;
    const focusable = () =>
      Array.from(root.querySelectorAll<HTMLElement>(SELECTOR))
        .filter(el => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true');

    // 1 · focus in — the first control, or the dialog itself if it has none.
    const first = focusable()[0];
    (first ?? root).focus();

    // 2 · Escape, and 3 · the tab trap.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) { event.preventDefault(); root.focus(); return; }
      const head = items[0];
      const tail = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const outside = !active || !root.contains(active);
      if (event.shiftKey && (active === head || outside)) { event.preventDefault(); tail.focus(); }
      else if (!event.shiftKey && (active === tail || outside)) { event.preventDefault(); head.focus(); }
    };
    document.addEventListener('keydown', onKeyDown, true);

    // 4 · the background is inert while the dialog is up.
    const hidden: { el: Element; aria: string | null }[] = [];
    let node: HTMLElement | null = root;
    while (node && node.parentElement) {
      const parent: HTMLElement = node.parentElement;
      for (const sibling of Array.from(parent.children)) {
        if (sibling === node) continue;
        hidden.push({ el: sibling, aria: sibling.getAttribute('aria-hidden') });
        sibling.setAttribute('aria-hidden', 'true');
      }
      node = parent === document.body ? null : parent;
    }

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      for (const entry of hidden) {
        if (entry.aria === null) entry.el.removeAttribute('aria-hidden');
        else entry.el.setAttribute('aria-hidden', entry.aria);
      }
      // 5 · focus goes back to whatever opened the dialog.
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [open, onClose]);

  return dialogRef;
}
