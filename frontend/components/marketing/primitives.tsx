/**
 * The marketing layout primitives.
 *
 * Every marketing page is built from these six pieces, so the section rhythm,
 * measure and heading scale are decided once here rather than re-typed per
 * page. They are plain server components: the marketing site ships no client
 * JavaScript unless a surface genuinely needs it (see `CodeTabs`).
 *
 * All of them render Tailwind `mk-` utilities, which resolve against the custom
 * properties in `app/marketing-tokens.css`. Those properties are scoped to
 * `[data-surface="marketing"]`, which `app/(marketing)/layout.tsx` sets, so a
 * primitive dropped onto a product screen renders unstyled instead of leaking
 * the marketing scale into the app.
 */
import type { ReactNode } from 'react';

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

/* ── section ─────────────────────────────────────────────────────────────── */

export type SectionTone = 'canvas' | 'alt' | 'band';

const SECTION_TONE: Record<SectionTone, string> = {
  canvas: 'bg-mk-canvas text-mk-ink',
  alt: 'bg-mk-canvas-alt text-mk-ink border-y border-mk-hairline',
  band: 'bg-mk-band text-mk-band-ink',
};

/**
 * One vertical band of the page. `tone` picks the surface; the alternating
 * canvas/alt rhythm is what gives a long landing page its sections without
 * drawing a rule between them.
 */
export function Section({
  children,
  tone = 'canvas',
  id,
  className,
  dark = false,
}: {
  children: ReactNode;
  tone?: SectionTone;
  id?: string;
  className?: string;
  /** Marks the region for the light focus ring in `globals.css`. */
  dark?: boolean;
}) {
  const isDark = dark || tone === 'band';
  return (
    <section
      id={id}
      data-sf-dark={isDark ? '' : undefined}
      className={cx('py-mk-section px-mk-gutter', SECTION_TONE[tone], className)}
    >
      {children}
    </section>
  );
}

/** The measured column every section's content sits in. */
export function Container({
  children,
  width = 'default',
  className,
}: {
  children: ReactNode;
  width?: 'default' | 'wide' | 'prose';
  className?: string;
}) {
  const max =
    width === 'wide' ? 'max-w-mk-wide' : width === 'prose' ? 'max-w-mk-prose' : 'max-w-mk-container';
  return <div className={cx('mx-auto w-full', max, className)}>{children}</div>;
}

/* ── type ────────────────────────────────────────────────────────────────── */

/** The small uppercase line above a heading. */
export function Eyebrow({ children, onDark = false }: { children: ReactNode; onDark?: boolean }) {
  return (
    <p
      className={cx(
        'm-0 mb-mk-stack text-mk-eyebrow uppercase',
        onDark ? 'text-mk-action-muted' : 'text-mk-action-fg',
      )}
    >
      {children}
    </p>
  );
}

/**
 * A display heading. `level` sets the tag so the document outline stays
 * correct; `size` sets the scale independently, because the page's second
 * section is still an `<h2>` even when it should read as large as the hero.
 */
export function Display({
  children,
  level = 2,
  size = 'lg',
  className,
}: {
  children: ReactNode;
  level?: 1 | 2 | 3;
  size?: 'xl' | 'lg' | 'md' | 'sm';
  className?: string;
}) {
  const Tag = (['h1', 'h2', 'h3'] as const)[level - 1];
  const scale = {
    xl: 'text-mk-display-xl',
    lg: 'text-mk-display-lg',
    md: 'text-mk-display-md',
    sm: 'text-mk-display-sm',
  }[size];
  return <Tag className={cx('m-0 font-display font-bold', scale, className)}>{children}</Tag>;
}

/** The sentence under a heading. Capped at a readable measure. */
export function Lead({
  children,
  onDark = false,
  center = false,
  className,
}: {
  children: ReactNode;
  onDark?: boolean;
  center?: boolean;
  className?: string;
}) {
  return (
    <p
      className={cx(
        'mt-mk-stack mb-0 max-w-mk-measure text-mk-copy-lg',
        onDark ? 'text-mk-band-ink-muted' : 'text-mk-ink-muted',
        center && 'mx-auto text-center',
        className,
      )}
    >
      {children}
    </p>
  );
}

/**
 * A centred section header: eyebrow, heading, lead. Used by every section that
 * is not the hero, which is what keeps them visually identical.
 */
export function SectionHeader({
  eyebrow,
  title,
  lead,
  tone = 'light',
  size = 'lg',
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  lead?: ReactNode;
  tone?: 'light' | 'dark';
  size?: 'lg' | 'md';
}) {
  const onDark = tone === 'dark';
  return (
    <header className="mb-mk-stack-lg text-center">
      {eyebrow ? (
        <p
          className={cx(
            'm-0 mb-3 text-mk-eyebrow uppercase',
            onDark ? 'text-mk-action-muted' : 'text-mk-action-fg',
          )}
        >
          {eyebrow}
        </p>
      ) : null}
      <Display level={2} size={size} className={onDark ? 'text-mk-band-ink' : undefined}>
        {title}
      </Display>
      {lead ? (
        <Lead onDark={onDark} center>
          {lead}
        </Lead>
      ) : null}
    </header>
  );
}

/* ── chip ────────────────────────────────────────────────────────────────── */

/** A small pill: a proof point, a plan tag, a compliance name. */
export function Chip({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'action' | 'sealed' | 'on-dark';
}) {
  const tones = {
    neutral: 'bg-mk-canvas-alt text-mk-ink-muted border-mk-hairline',
    action: 'bg-mk-action-subtle text-mk-action-fg border-mk-action-muted',
    sealed: 'bg-mk-sealed-subtle text-mk-sealed-fg border-mk-sealed-border',
    'on-dark': 'bg-mk-band-hairline/10 text-mk-band-ink border-mk-band-hairline/20',
  }[tone];
  return (
    <span
      className={cx(
        'inline-flex items-center gap-2 rounded-mk-chip border px-3 py-1 text-mk-copy-xs font-semibold',
        tones,
      )}
    >
      {children}
    </span>
  );
}

/** A responsive card grid. Marketing pages only ever want 2, 3 or 4 up. */
export function Grid({
  children,
  columns = 3,
  className,
}: {
  children: ReactNode;
  columns?: 2 | 3 | 4;
  className?: string;
}) {
  const cols = {
    2: 'sm:grid-cols-2',
    3: 'sm:grid-cols-2 lg:grid-cols-3',
    4: 'sm:grid-cols-2 lg:grid-cols-4',
  }[columns];
  return (
    <ul className={cx('m-0 grid list-none gap-mk-grid p-0 grid-cols-1', cols, className)}>
      {children}
    </ul>
  );
}

/** The card every grid cell uses. */
export function Card({
  children,
  as: Tag = 'li',
  featured = false,
  className,
}: {
  children: ReactNode;
  as?: 'li' | 'div';
  featured?: boolean;
  className?: string;
}) {
  return (
    <Tag
      className={cx(
        'rounded-mk-card border bg-mk-card p-6 text-left',
        featured ? 'border-mk-action shadow-mk-card' : 'border-mk-hairline',
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export { cx };
