/**
 * Public signing chrome. Deliberately *not* the app shell: a recipient has no
 * account, no workspace and no navigation — just the envelope, a brand mark and
 * the security note. No session is read here, so this layout renders for an
 * expired link exactly as it does for a live one.
 */

import type { Metadata } from 'next';
import { SF_FONT } from '@/lib/sf/fallback';

export const metadata: Metadata = { title: 'Sign · SignerPro' };

export default function SignLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#eceff4', fontFamily: SF_FONT, color: '#0f172a' }}>
      <header style={{ flex: '0 0 auto', background: '#fff', borderBottom: '1px solid #e3e7ee', padding: '11px 18px', display: 'flex', alignItems: 'center', gap: '11px' }}>
        <span style={{ width: '28px', height: '28px', borderRadius: '9px', background: '#4f46e5', color: '#fff', display: 'grid', placeItems: 'center', fontSize: '.71875rem', fontWeight: 700, letterSpacing: '-.5px' }}>SF</span>
        <span style={{ fontSize: '.84375rem', fontWeight: 700, letterSpacing: '-.2px' }}>SignerPro</span>
        <span style={{ marginLeft: 'auto', fontSize: '.6875rem', color: '#64748b', fontFamily: 'var(--font-sans)' }}>Secure signing session · SHA-256 sealed · tamper-evident audit trail</span>
      </header>
      <main style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{children}</main>
    </div>
  );
}
