'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The measured content width of an element, in CSS px.
 *
 * The document surfaces size their pages from this rather than from a hardcoded
 * sheet, which is what makes them usable below 816 px — the signing surface used
 * to pan horizontally on every phone, and most e-signature traffic is mobile.
 */
export function useElementWidth<T extends HTMLElement>(): [(node: T | null) => void, number] {
  const [width, setWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);

  const ref = useCallback((node: T | null) => {
    if (observer.current) { observer.current.disconnect(); observer.current = null; }
    if (!node) return;
    setWidth(node.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    observer.current = new ResizeObserver(entries => {
      for (const entry of entries) setWidth(entry.contentRect.width);
    });
    observer.current.observe(node);
  }, []);

  useEffect(() => () => { if (observer.current) observer.current.disconnect(); }, []);

  return [ref, width];
}
