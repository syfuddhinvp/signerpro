/**
 * The format badge on document headers: a red page with 'PDF' set in white.
 *
 * The header used to spell out 'DOC' in 9px type on an indigo tile, which
 * named the format without looking like it. This is drawn as SVG so the page
 * shape, the folded corner and the letters scale together at any size and do
 * not depend on the user's fallback font for the mark itself.
 */
import type { CSSProperties } from 'react';

export type PdfBadgeProps = {
  /** Rendered size in px; the 24×24 grid scales with it. */
  size?: number;
  style?: CSSProperties;
};

/** Decorative by contract: every header that draws one already carries the
 *  document name in text, so the SVG stays out of the a11y tree. */
export default function PdfBadge({ size = 24, style }: PdfBadgeProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      style={{ display:'block', flex:'0 0 auto', ...style }}
    >
      {/* The page, with the top-right corner cut away for the fold. */}
      <path d="M5 3.6A1.6 1.6 0 0 1 6.6 2h7.7L20 7.7v12.7A1.6 1.6 0 0 1 18.4 22H6.6A1.6 1.6 0 0 1 5 20.4z" fill="#dc2626" />
      {/* The fold itself, a shade darker so it reads as turned-back paper. */}
      <path d="M14.3 2 20 7.7h-5.7z" fill="#991b1b" />
      <text
        x="12.5" y="17.4" textAnchor="middle"
        fill="#fff" fontSize="7.2" fontWeight={700} letterSpacing="-.3"
        fontFamily="inherit"
      >PDF</text>
    </svg>
  );
}
