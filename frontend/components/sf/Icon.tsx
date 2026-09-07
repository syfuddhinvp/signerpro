/**
 * The sidebar's icon set, as inline SVG.
 *
 * These rows used to carry single glyph characters ('⌂', '▤', '‹›'). Each one
 * rendered at whatever weight and baseline the user's fallback font happened
 * to supply, so the set read as a pile of unrelated marks — and several of
 * them said nothing about the destination. One 24px grid, one stroke weight
 * and `currentColor` gives the rail a single voice, at any size, in any font.
 */
import type { CSSProperties } from 'react';

export type IconName =
  | 'home' | 'documents' | 'contacts' | 'reports' | 'developer' | 'support'
  | 'account' | 'tenants' | 'revenue'
  | 'chevronLeft' | 'chevronRight' | 'signOut' | 'close' | 'bell';

/* Paths are drawn on a 24×24 grid, stroked rather than filled, so one weight
   carries across the whole set. */
const PATHS: Record<IconName, string> = {
  home: 'M4 10.2 12 4l8 6.2V19a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z',
  documents: 'M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v5h5M9 13h6M9 17h4',
  contacts: 'M12 12a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2zM4.8 20a7.2 7.2 0 0 1 14.4 0',
  reports: 'M4 20h16M7.5 20v-6M12 20V7M16.5 20v-9',
  developer: 'M8.5 8.5 4.5 12l4 3.5M15.5 8.5l4 3.5-4 3.5M13.5 5l-3 14',
  support: 'M4.5 12a7.5 7.5 0 0 1 15 0v5.2a2.3 2.3 0 0 1-2.3 2.3H13M4.5 12v3a2 2 0 0 0 2 2h1v-5h-3zM19.5 12h-3v5h1a2 2 0 0 0 2-2z',
  account: 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM19.4 14.6a1.5 1.5 0 0 0 .3 1.7l.1.1a1.8 1.8 0 1 1-2.6 2.6l-.1-.1a1.5 1.5 0 0 0-2.6 1.1v.2a1.8 1.8 0 1 1-3.6 0v-.1a1.5 1.5 0 0 0-2.6-1.1l-.1.1a1.8 1.8 0 1 1-2.6-2.6l.1-.1a1.5 1.5 0 0 0-1.1-2.6h-.2a1.8 1.8 0 1 1 0-3.6h.1a1.5 1.5 0 0 0 1.1-2.6l-.1-.1a1.8 1.8 0 1 1 2.6-2.6l.1.1a1.5 1.5 0 0 0 2.6-1.1V4a1.8 1.8 0 1 1 3.6 0v.1a1.5 1.5 0 0 0 2.6 1.1l.1-.1a1.8 1.8 0 1 1 2.6 2.6l-.1.1a1.5 1.5 0 0 0 1.1 2.6h.2a1.8 1.8 0 1 1 0 3.6h-.1a1.5 1.5 0 0 0-1.4.9z',
  tenants: 'M4 20V8.5L11 5v15M11 20h9V11l-9-3.4M14.5 12h2M14.5 15.5h2M7 11h1M7 14.5h1',
  revenue: 'M12 4v16M15.5 7.8A3.4 3.4 0 0 0 12.3 6h-.9a2.9 2.9 0 0 0-.6 5.7l2.4.6a2.9 2.9 0 0 1-.6 5.7h-.9a3.4 3.4 0 0 1-3.2-1.8',
  chevronLeft: 'M14.5 6.5 9 12l5.5 5.5',
  chevronRight: 'M9.5 6.5 15 12l-5.5 5.5',
  signOut: 'M14 5H6.5a1.5 1.5 0 0 0-1.5 1.5v11A1.5 1.5 0 0 0 6.5 19H14M16 8.5 19.5 12 16 15.5M10 12h9.5',
  close: 'M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5',
  bell: 'M18 10a6 6 0 1 0-12 0c0 4.2-1.5 5.6-1.5 5.6h15S18 14.2 18 10zM10.2 19a2 2 0 0 0 3.6 0',
};

export type IconProps = {
  name: IconName;
  /** Rendered size in px; the grid scales with it. */
  size?: number;
  style?: CSSProperties;
};

/** Decorative by contract: every place that draws one already carries the
 *  label in text or in `aria-label`, so the SVG stays out of the a11y tree. */
export default function Icon({ name, size = 15, style }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ display:'block', flex:'0 0 auto', ...style }}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
