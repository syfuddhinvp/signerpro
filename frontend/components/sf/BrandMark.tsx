/**
 * The product's logo.
 *
 * Both the sidebar's brand rail and the auth screen's dark panel used to draw
 * the mark as the two letters "SF" in a rounded accent square, which meant the
 * logo was really whatever font the browser picked — it changed weight and
 * baseline between platforms and said nothing about what the product does.
 *
 * One 32×32 grid instead: a signature stroke finishing on a ruled line, drawn
 * as vector so it stays crisp at a 20px favicon and a 64px marketing size
 * alike. The square takes the accent from the caller (`useSF().accent()`) so a
 * tenant's own brand colour carries into the logo rather than fighting it.
 */
import type { CSSProperties } from 'react';

/* Drawn on a 32×32 grid: the flourish rises out of the baseline, loops, and
   settles back onto it — the shape of a name being signed. */
const SIGNATURE = 'M8.4 20.9c2.4-1.6 4-4.5 5.3-8.2.9-2.4 2.3-2.2 1.9.4-.4 2.7-1.8 6.2-1.8 6.2s2.2-3.2 3.7-3.2c1.2 0 .5 2.3 1.6 2.3 1 0 1.9-.9 2.7-2';
const BASELINE = 'M8 24.6h16';

export type BrandMarkProps = {
  /** Rendered size in px; the grid scales with it. */
  size?: number;
  /** The square's fill. Pass the session accent so tenant branding carries. */
  accent: string;
  /** Corner radius in px, so a 30px rail mark and a 64px mark both look right. */
  radius?: number;
  style?: CSSProperties;
};

/** Decorative by contract: every place that draws the mark already carries the
 *  product name in adjacent text or in the link's accessible name. */
export default function BrandMark({ size = 30, accent, radius, style }: BrandMarkProps) {
  const r = radius ?? Math.round(size * 0.3);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block', flex: '0 0 auto', borderRadius: r + 'px', ...style }}
    >
      <rect x="0" y="0" width="32" height="32" rx={(r / size) * 32} fill={accent} />
      <g
        fill="none"
        stroke="#ffffff"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={SIGNATURE} />
        <path d={BASELINE} opacity={0.75} />
      </g>
    </svg>
  );
}
