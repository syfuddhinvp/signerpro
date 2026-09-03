'use client';

/**
 * `/login` — real sign-in against `POST /api/auth/login`, which sets the
 * httpOnly `sf_session` cookie and answers `{ ok, user, next }`, or
 * `{ ok, mfaRequired, mfaToken, … }` when the account has a second factor
 * confirmed. The challenge is handed to `/login/verify`; no session exists
 * until the code is exchanged there.
 */

import { useState, type CSSProperties, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSF } from '@/lib/sf/state';
import { lbl, authInput, authPrimary as authPrimaryOf, linkBtn as linkBtnOf, BORDER_STRONG } from '@/lib/sf/ui';
import { AUTH_PATHS } from '@/lib/sf/routes';
import { storeChallenge } from '@/lib/auth/mfa-challenge';
import AuthLayout, { authErrorMessage, authErrorStyle } from './AuthLayout';

export default function SignInForm() {
  const { s, set, flash, accent } = useSF();
  const router = useRouter();
  const params = useSearchParams();
  const A = accent();

  const authPrimary = authPrimaryOf(A);
  const linkBtn = linkBtnOf(A);
  const linkStyle: CSSProperties = Object.assign({}, linkBtn, { textDecoration: 'none' });

  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const rememberRow: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: '8px', background: 'none', border: 'none', padding: 0, cursor: 'pointer' };
  const rememberBox: CSSProperties = {
    width: '17px', height: '17px', borderRadius: '5px', display: 'grid', placeItems: 'center', fontSize: '.6875rem',
    color: '#fff', flex: '0 0 17px', border: '1px solid ' + (s.remember ? A : BORDER_STRONG), background: s.remember ? A : '#fff',
  };
  const rememberMark = s.remember ? '✓' : '';

  const submitSignin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    if (s.authEmail.indexOf('@') < 1) { setError('Enter a valid work email.'); return; }
    if (!s.authPassword) { setError('Enter your password.'); return; }

    setPending(true);
    setError('');
    const next = params.get('next') || undefined;
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: s.authEmail,
          password: s.authPassword,
          remember: s.remember === true,
          next,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        const msg = authErrorMessage(data?.code, data?.error);
        setError(msg);
        flash(msg);
        return;
      }

      // A confirmed second factor: no cookie was minted, only a 5-minute
      // challenge token. Carry it to the verify screen.
      if (data.mfaRequired === true) {
        storeChallenge({
          mfaToken: data.mfaToken,
          delivery: typeof data.delivery === 'string' ? data.delivery : 'totp',
          maskedTarget: typeof data.maskedTarget === 'string' ? data.maskedTarget : '',
          email: s.authEmail,
          remember: s.remember === true,
          next,
        });
        set({ authPassword: '', mfaCode: '' });
        router.replace(AUTH_PATHS.mfa);
        return;
      }

      set({ authPassword: '', mfaCode: '' });
      router.replace(typeof data.next === 'string' && data.next ? data.next : '/overview');
    } catch {
      const msg = authErrorMessage('backend_unreachable');
      setError(msg);
      flash(msg);
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthLayout mode="signin">
      <form onSubmit={submitSignin} style={{ display: 'flex', flexDirection: 'column', gap: '13px' }}>
        <label style={lbl}>Work email
          <input type="email" name="email" value={s.authEmail} onChange={(e) => set({ authEmail: e.target.value })} placeholder="you@company.com" autoComplete="username" required style={authInput} />
        </label>
        <label style={lbl}>Password
          <input type="password" name="password" value={s.authPassword} onChange={(e) => set({ authPassword: e.target.value })} placeholder="••••••••••" autoComplete="current-password" required style={authInput} />
        </label>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
          <button type="button" role="switch" aria-checked={s.remember} onClick={() => set({ remember: !s.remember })} style={rememberRow}>
            <span style={rememberBox}>{rememberMark}</span>
            <span style={{ fontSize: '.75rem', color: '#334155' }}>Remember this device</span>
          </button>
          <Link href={AUTH_PATHS.forgot} style={linkStyle}>Forgot password?</Link>
        </div>
        {error ? <div role="alert" style={authErrorStyle}>{error}</div> : null}
        <button type="submit" disabled={pending} style={authPrimary}>{pending ? 'Signing in…' : 'Continue'}</button>
      </form>
    </AuthLayout>
  );
}
