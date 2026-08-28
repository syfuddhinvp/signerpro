'use client';

/**
 * `/login/verify` — two-factor step. The backend has no MFA verification
 * endpoint yet, so this keeps the prototype's client-side behaviour.
 * TODO: verify the code against `POST /api/auth/mfa/verify` once it exists.
 */

import { type CSSProperties } from 'react';
import Link from 'next/link';
import { useSF } from '@/lib/sf/state';
import { btn, lbl, authInput, authPrimary as authPrimaryOf, linkBtn as linkBtnOf } from '@/lib/sf/ui';
import { AUTH_PATHS } from '@/lib/sf/routes';
import AuthLayout from './AuthLayout';

export default function MfaForm() {
  const { s, set, flash, accent } = useSF();
  const A = accent();

  const authPrimary = authPrimaryOf(A);
  const linkBtn = linkBtnOf(A);
  const ghostBtn = btn('#fff', '#475569', '#e3e7ee');

  const mfaNote = 'Code sent to the authenticator registered to ' + s.authEmail + '. Any 6 digits are accepted in this prototype.';
  const mfaNoteStyle: CSSProperties = { fontSize: '11.5px', color: '#3730a3', background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: '10px', padding: '10px 11px', lineHeight: 1.55 };
  const mfaInput: CSSProperties = Object.assign({}, authInput, {
    fontFamily: "'Inter', 'Google Sans Flex', sans-serif", fontSize: '19px', letterSpacing: '.34em', textAlign: 'center' as const, height: '46px',
  });

  const submitMfa = () => {
    if (s.mfaCode.replace(/\D/g, '').length !== 6) { flash('Enter the 6-digit code (any digits work here)'); return; }
    // TODO: `POST /api/auth/mfa/verify` — no backend endpoint yet, so this
    // cannot mint a session; it keeps the prototype's confirmation only.
    set({ mfaCode: '', authPassword: '' });
    flash('Signed in to Acme Corporation');
  };
  const usePasskey = () => {
    // TODO: `POST /api/auth/passkey` (WebAuthn assertion) — no backend endpoint yet.
    set({ mfaCode: '', authPassword: '' });
    flash('Signed in to Acme Corporation');
  };
  const backHref = AUTH_PATHS.signin;

  return (
    <AuthLayout mode="mfa">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={mfaNoteStyle}>{mfaNote}</div>
        <label style={lbl}>6-digit code
          <input type="text" value={s.mfaCode} onChange={(e) => set({ mfaCode: e.target.value })} inputMode="numeric" maxLength={6} placeholder="123456" aria-label="Verification code" style={mfaInput} />
        </label>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button type="button" onClick={submitMfa} style={authPrimary}>Verify &amp; sign in</button>
          <button type="button" onClick={usePasskey} style={ghostBtn}>Use passkey</button>
        </div>
        <Link href={backHref} onClick={() => set({ mfaCode: '' })} style={Object.assign({}, linkBtn, { textDecoration: 'none' })}>← Use a different account</Link>
      </div>
    </AuthLayout>
  );
}
