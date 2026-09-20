/**
 * The marketing call-to-action button.
 *
 * Separate from the application's button because the two answer to different
 * rules: an app control is 8px-radius, compact and sits in a dense toolbar,
 * while a marketing CTA is a pill at least 44px tall (WCAG 2.2 target size,
 * with the 24px floor cleared several times over) and is the one thing on the
 * band the eye should land on.
 *
 * There is exactly one `variant="solid"` per section. Growth.Design's
 * landing-page review names competing primary actions as the most common
 * conversion mistake, so the page spends its contrast on a single action and
 * renders every other route as `ghost` or `outline`.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';
import { cx } from './primitives';

export type CtaVariant = 'solid' | 'outline' | 'ghost' | 'on-dark';

const VARIANT: Record<CtaVariant, string> = {
  solid:
    'bg-mk-action text-mk-action-ink shadow-mk-cta hover:bg-mk-action-hover active:bg-mk-action-active border-transparent',
  outline:
    'bg-mk-card text-mk-ink border-mk-control-edge hover:border-mk-action hover:text-mk-action-fg',
  ghost: 'bg-transparent text-mk-ink border-transparent hover:bg-mk-canvas-alt',
  'on-dark':
    'bg-transparent text-mk-band-ink border-mk-band-hairline/40 hover:bg-mk-band-hairline/10',
};

export function Cta({
  href,
  children,
  variant = 'solid',
  size = 'md',
  block = false,
  className,
}: {
  href: string;
  children: ReactNode;
  variant?: CtaVariant;
  size?: 'md' | 'lg';
  block?: boolean;
  className?: string;
}) {
  const sizing =
    size === 'lg'
      ? 'min-h-mk-cta-lg px-7 text-mk-copy-md'
      : 'min-h-mk-cta px-5 text-mk-copy-sm';
  return (
    <Link
      href={href}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-mk-cta border font-semibold no-underline',
        'transition-colors duration-fast ease-standard hover:no-underline',
        sizing,
        VARIANT[variant],
        block && 'flex w-full',
        className,
      )}
    >
      {children}
    </Link>
  );
}

/** The row a hero or band puts its two actions in. */
export function CtaRow({
  children,
  center = false,
  className,
}: {
  children: ReactNode;
  center?: boolean;
  className?: string;
}) {
  return (
    <div className={cx('flex flex-wrap items-center gap-3', center && 'justify-center', className)}>
      {children}
    </div>
  );
}
