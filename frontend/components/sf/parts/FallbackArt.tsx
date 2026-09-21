/**
 * The illustration on the framework-level fallbacks.
 *
 * Purely decorative and sized by its container: an error page is already a
 * dead end, so the picture carries the tone (a page that came apart, not data
 * that was lost) while the heading and body carry the meaning. Inline SVG with
 * no external asset — the error boundary may be rendering precisely because
 * the rest of the app failed to load.
 */
export default function FallbackArt({ tone = 'error' }: { tone?: 'error' | 'missing' }) {
  const accent = tone === 'error' ? 'hsl(var(--color-bg-warning-solid))' : 'hsl(var(--color-accent-solid))';
  return (
    <svg
      viewBox="0 0 420 340"
      fill="none"
      role="presentation"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block', width: '100%', height: 'auto' }}
    >
      {/* the blob the scene sits in, so the art holds its own at full width */}
      <circle cx="228" cy="160" r="132" fill="hsl(var(--color-accent-solid))" opacity=".08" />
      <ellipse cx="210" cy="298" rx="132" ry="14" fill="hsl(var(--color-fg-default))" opacity=".05" />

      {/* loose sheets scattered on the ground */}
      <g opacity=".55">
        <rect
          x="24" y="248" width="72" height="52" rx="6"
          fill="hsl(var(--color-bg-surface))" stroke="hsl(var(--color-border-default))" strokeWidth="2.5" transform="rotate(-16 60 274)"
        />
        <rect
          x="322" y="252" width="72" height="52" rx="6"
          fill="hsl(var(--color-bg-surface))" stroke="hsl(var(--color-border-default))" strokeWidth="2.5" transform="rotate(13 358 278)"
        />
      </g>

      {/* the sheet behind, hinting at a stack */}
      <rect
        x="196" y="56" width="150" height="192" rx="14"
        fill="hsl(var(--color-bg-surface))" stroke="hsl(var(--color-border-subtle))" strokeWidth="3" transform="rotate(8 271 152)"
      />

      {/* the sheet that came apart */}
      <g transform="rotate(-6 186 152)">
        <path
          d="M110 70a14 14 0 0 1 14-14h84l44 44v128a14 14 0 0 1-14 14H124a14 14 0 0 1-14-14V70Z"
          fill="hsl(var(--color-bg-surface))" stroke="hsl(var(--color-border-default))" strokeWidth="3"
        />
        {/* folded corner */}
        <path d="M208 56v30a14 14 0 0 0 14 14h30L208 56Z" fill="hsl(var(--color-bg-muted))" stroke="hsl(var(--color-border-default))" strokeWidth="3" />

        {/* body copy lines */}
        <rect x="134" y="128" width="80" height="8" rx="4" fill="hsl(var(--color-border-subtle))" />
        <rect x="134" y="150" width="100" height="8" rx="4" fill="hsl(var(--color-border-subtle))" />
        <rect x="134" y="172" width="60" height="8" rx="4" fill="hsl(var(--color-border-subtle))" />

        {/* the signature — what this product is actually about */}
        <path
          d="M134 214c10-15 19 9 28-4s16-19 25-7 14 5 21-2"
          stroke="hsl(var(--color-accent-solid))" strokeWidth="4" strokeLinecap="round"
        />
        <rect x="134" y="232" width="92" height="3" rx="1.5" fill="hsl(var(--color-border-subtle))" />
      </g>

      {/* the tear: a jagged split straight across the sheet */}
      <path
        d="M96 190l26-11 14 13 23-14 18 14 25-16 21 15 27-13"
        stroke="hsl(var(--color-bg-canvas))" strokeWidth="13" strokeLinecap="round" strokeLinejoin="round"
      />
      <path
        d="M96 190l26-11 14 13 23-14 18 14 25-16 21 15 27-13"
        stroke="hsl(var(--color-border-default))" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
        strokeDasharray="12 10"
      />

      {/* status badge */}
      <circle cx="300" cy="212" r="46" fill="hsl(var(--color-bg-surface))" />
      <circle cx="300" cy="212" r="36" fill={accent} opacity=".14" />
      <circle cx="300" cy="212" r="36" stroke={accent} strokeWidth="4" />
      {tone === 'error' ? (
        <>
          <rect x="296" y="192" width="8" height="26" rx="4" fill={accent} />
          <circle cx="300" cy="230" r="4.5" fill={accent} />
        </>
      ) : (
        <>
          <circle cx="295" cy="207" r="15" stroke={accent} strokeWidth="5" />
          <path d="M306 218l11 11" stroke={accent} strokeWidth="5" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}
