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
  | 'chevronLeft' | 'chevronRight' | 'signOut' | 'close' | 'bell'
  | 'check' | 'minus' | 'alert' | 'arrowRight' | 'asterisk'
  | 'trash' | 'pencil' | 'star' | 'checkbox' | 'stamp' | 'move'
  | 'fit' | 'distribute' | 'radio' | 'caretDown' | 'upload'
  | 'undo' | 'redo' | 'plus' | 'fitWidth' | 'grid' | 'alignLeft' | 'alignCenter'
  | 'duplicate' | 'duplicateAll' | 'preview' | 'externalLink'
  | 'arrowUp' | 'arrowDown' | 'arrowLeft' | 'caretUp' | 'sortAsc' | 'sortDesc';

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
  check: 'M5 12.5 9.5 17 19 7.5',
  minus: 'M6 12h12',
  alert: 'M12 5v9M12 18.2v.2',
  arrowRight: 'M4.5 12h14M13.5 7 18.5 12l-5 5',
  asterisk: 'M12 5v14M6 8.5l12 7M18 8.5l-12 7',
  trash: 'M4.5 7h15M9.5 7V4.8a.8.8 0 0 1 .8-.8h3.4a.8.8 0 0 1 .8.8V7M6.5 7l.9 12.3a.8.8 0 0 0 .8.7h7.6a.8.8 0 0 0 .8-.7L17.5 7M10 11v5.5M14 11v5.5',
  pencil: 'M4.5 19.5h3.2L18.8 8.4a1.6 1.6 0 0 0 0-2.3l-.9-.9a1.6 1.6 0 0 0-2.3 0L4.5 16.3zM14.4 6.6l3 3',
  checkbox: 'M5.5 4.5h13a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1zM8 12l3 3 5-5.5',
  stamp: 'M9 4.5h6a2 2 0 0 1 2 2.2l-.6 5.3h-8.8L7 6.7a2 2 0 0 1 2-2.2zM4.5 12h15v2.5h-15zM6.5 17h11v2.5h-11z',
  move: 'M12 4.5v15M4.5 12h15M12 4.5 9.6 7M12 4.5 14.4 7M12 19.5 9.6 17M12 19.5 14.4 17M4.5 12 7 9.6M4.5 12 7 14.4M19.5 12 17 9.6M19.5 12 17 14.4',
  fit: 'M4.5 9V4.5H9M15 4.5h4.5V9M19.5 15v4.5H15M9 19.5H4.5V15',
  distribute: 'M4 6h16M4 12h16M4 18h16',
  undo: 'M8.5 9.5H15a4.5 4.5 0 0 1 0 9h-6M8.5 9.5 12 6M8.5 9.5 12 13',
  redo: 'M15.5 9.5H9a4.5 4.5 0 0 0 0 9h6M15.5 9.5 12 6M15.5 9.5 12 13',
  plus: 'M12 6v12M6 12h12',
  fitWidth: 'M3.5 12h17M7 8.5 3.5 12 7 15.5M17 8.5 20.5 12 17 15.5',
  grid: 'M4 4.5h16v15H4zM4 9.5h16M4 14.5h16M9 4.5v15M14.5 4.5v15',
  alignLeft: 'M4.5 4v16M8 8h11M8 16h7',
  alignCenter: 'M12 4v16M6.5 8h11M8.5 16h7',
  duplicate: 'M9 9h9.5a.5.5 0 0 1 .5.5V19a.5.5 0 0 1-.5.5H9a.5.5 0 0 1-.5-.5V9.5A.5.5 0 0 1 9 9zM5.5 15H5a.5.5 0 0 1-.5-.5V5A.5.5 0 0 1 5 4.5h9.5a.5.5 0 0 1 .5.5v.5',
  duplicateAll: 'M9 9h9.5a.5.5 0 0 1 .5.5V19a.5.5 0 0 1-.5.5H9a.5.5 0 0 1-.5-.5V9.5A.5.5 0 0 1 9 9zM5.5 15H5a.5.5 0 0 1-.5-.5V5A.5.5 0 0 1 5 4.5h9.5a.5.5 0 0 1 .5.5v.5M13.8 12v4.5M11.5 14.2H16',
  preview: 'M4.5 5h15a.5.5 0 0 1 .5.5v13a.5.5 0 0 1-.5.5h-15a.5.5 0 0 1-.5-.5v-13a.5.5 0 0 1 .5-.5zM4 9.5h6.5V19',
  externalLink: 'M13.5 4.5h6v6M19.5 4.5 11 13M17 14v5a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 5 19V8a.5.5 0 0 1 .5-.5H10',
  arrowUp: 'M12 19V5.5M6.5 11 12 5.5 17.5 11',
  arrowDown: 'M12 5v13.5M6.5 13 12 18.5 17.5 13',
  arrowLeft: 'M19.5 12h-14M10.5 7 5.5 12l5 5',
  caretUp: 'M6.5 14.5 12 9l5.5 5.5',
  sortAsc: 'M12 19V6M7 11l5-5 5 5',
  sortDesc: 'M12 5v13M7 13l5 5 5-5',
  radio: 'M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  caretDown: 'M6.5 9.5 12 15l5.5-5.5',
  upload: 'M12 16V4.5M7.5 9 12 4.5 16.5 9M4.5 15.5v3a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-3',
  bell: 'M18 10a6 6 0 1 0-12 0c0 4.2-1.5 5.6-1.5 5.6h15S18 14.2 18 10zM10.2 19a2 2 0 0 0 3.6 0',
  star: 'M12 4.2l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.6-4.8 2.6.9-5.4L4.2 9.9l5.4-.8z',
};

export type IconProps = {
  name: IconName;
  /** Rendered size in px; the grid scales with it. */
  size?: number;
  /** Fill the shape with `currentColor` — used for the on state of a mark that
   *  has both (a favourite star, say), so outline and solid stay one drawing. */
  solid?: boolean;
  style?: CSSProperties;
};

/** Decorative by contract: every place that draws one already carries the
 *  label in text or in `aria-label`, so the SVG stays out of the a11y tree. */
export default function Icon({ name, size = 15, solid, style }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={solid ? 'currentColor' : 'none'}
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
