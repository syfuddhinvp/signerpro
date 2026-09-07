/**
 * Shared styling for the framework-level fallbacks (not-found, error,
 * loading). Kept in one place so an error page can never drift into looking
 * like default Next.js scaffolding.
 */
import type { CSSProperties } from 'react';
import { TEXT_MUTED } from '@/lib/sf/ui';

export const SF_FONT = "var(--font-geist), system-ui, -apple-system, 'Segoe UI', sans-serif";

export const fallbackPage: CSSProperties = {
  minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '48px 32px',
  background: '#f5f6f8', color: '#0f172a', fontFamily: SF_FONT,
};

/**
 * The two-column hero: copy on the left, illustration on the right. It wraps
 * to a single stacked column on narrow viewports — these styles are inline
 * (the boundary may render without the stylesheet), so `flexWrap` does the
 * job a media query would.
 */
export const fallbackHero: CSSProperties = {
  width: '100%', maxWidth: '1040px', display: 'flex', flexWrap: 'wrap-reverse',
  alignItems: 'center', justifyContent: 'center', gap: '40px 64px',
};

export const fallbackCopy: CSSProperties = {
  flex: '1 1 340px', maxWidth: '460px', display: 'flex', flexDirection: 'column',
  alignItems: 'flex-start', gap: '16px', textAlign: 'left',
};

export const fallbackArt: CSSProperties = {
  flex: '1 1 340px', maxWidth: '480px', minWidth: 0,
};

export const fallbackCard: CSSProperties = {
  width: '100%', maxWidth: '460px', background: '#fff', border: '1px solid #e3e7ee',
  borderRadius: '16px', padding: '28px', boxShadow: '0 18px 40px -28px rgba(15,23,42,.35)',
  display: 'flex', flexDirection: 'column', gap: '14px', textAlign: 'center',
  alignItems: 'center',
};

export const fallbackMark: CSSProperties = {
  width: '34px', height: '34px', borderRadius: '10px', background: '#4f46e5', color: '#fff',
  display: 'grid', placeItems: 'center', fontSize: '.8125rem', fontWeight: 700, letterSpacing: '-.5px',
};

export const fallbackTitle: CSSProperties = {
  margin: 0, fontSize: '1.1875rem', fontWeight: 650, letterSpacing: '-.01em', color: '#0f172a',
};

/** The hero heading, which has a whole column to itself rather than a card. */
export const fallbackHeadline: CSSProperties = {
  margin: 0, fontSize: 'clamp(1.75rem, 1.2rem + 2.2vw, 2.625rem)', fontWeight: 700,
  letterSpacing: '-.02em', lineHeight: 1.15, color: '#0f172a',
};

export const fallbackBody: CSSProperties = {
  margin: 0, fontSize: '.8125rem', lineHeight: 1.6, color: '#64748b',
  fontFamily: 'var(--font-sans)',
};

/** Body copy at hero scale, to sit under {@link fallbackHeadline}. */
export const fallbackLead: CSSProperties = {
  ...fallbackBody, fontSize: '.9375rem', lineHeight: 1.65,
};

export const fallbackCode: CSSProperties = {
  ...fallbackBody, fontSize: '.6875rem', color: TEXT_MUTED, wordBreak: 'break-all',
};

export const fallbackRow: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '6px' };

export const fallbackPrimary: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: '7px', height: '40px', padding: '0 18px',
  borderRadius: '9px', border: '1px solid #4f46e5', background: '#4f46e5', color: '#fff',
  fontSize: '.84375rem', fontWeight: 600, cursor: 'pointer', textDecoration: 'none',
  fontFamily: SF_FONT,
};

export const fallbackGhost: CSSProperties = {
  ...fallbackPrimary, background: '#fff', color: '#475569', borderColor: '#e3e7ee',
};
