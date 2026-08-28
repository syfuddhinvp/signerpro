/**
 * Shared styling for the framework-level fallbacks (not-found, error,
 * loading). Kept in one place so an error page can never drift into looking
 * like default Next.js scaffolding.
 */
import type { CSSProperties } from 'react';

export const SF_FONT = "'Google Sans Flex', 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif";

export const fallbackPage: CSSProperties = {
  minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '32px',
  background: '#f5f6f8', color: '#0f172a', fontFamily: SF_FONT,
};

export const fallbackCard: CSSProperties = {
  width: '100%', maxWidth: '460px', background: '#fff', border: '1px solid #e3e7ee',
  borderRadius: '16px', padding: '28px', boxShadow: '0 18px 40px -28px rgba(15,23,42,.35)',
  display: 'flex', flexDirection: 'column', gap: '14px', textAlign: 'center',
  alignItems: 'center',
};

export const fallbackMark: CSSProperties = {
  width: '34px', height: '34px', borderRadius: '10px', background: '#4f46e5', color: '#fff',
  display: 'grid', placeItems: 'center', fontSize: '13px', fontWeight: 700, letterSpacing: '-.5px',
};

export const fallbackTitle: CSSProperties = {
  margin: 0, fontSize: '19px', fontWeight: 650, letterSpacing: '-.01em', color: '#0f172a',
};

export const fallbackBody: CSSProperties = {
  margin: 0, fontSize: '13px', lineHeight: 1.6, color: '#64748b',
  fontFamily: "'Inter', 'Google Sans Flex', sans-serif",
};

export const fallbackCode: CSSProperties = {
  ...fallbackBody, fontSize: '11px', color: '#94a3b8', wordBreak: 'break-all',
};

export const fallbackRow: CSSProperties = { display: 'flex', gap: '9px', marginTop: '4px' };

export const fallbackPrimary: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: '7px', height: '34px', padding: '0 14px',
  borderRadius: '9px', border: '1px solid #4f46e5', background: '#4f46e5', color: '#fff',
  fontSize: '12.5px', fontWeight: 600, cursor: 'pointer', textDecoration: 'none',
  fontFamily: SF_FONT,
};

export const fallbackGhost: CSSProperties = {
  ...fallbackPrimary, background: '#fff', color: '#475569', borderColor: '#e3e7ee',
};
