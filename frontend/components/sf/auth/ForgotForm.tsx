'use client';

/**
 * `/login/forgot` — request a reset link from `POST /api/auth/password/forgot`.
 *
 * The endpoint is enumeration-safe upstream: it answers identically for an
 * address that has no account, so this screen shows the same confirmation
 * either way and never reveals whether the address is registered. The stated
 * validity matches the backend (`PASSWORD_RESET_TTL_MINUTES = 60`).
 */

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useSF } from '@/lib/sf/state';
import { lbl, authInput, authPrimary as authPrimaryOf, linkBtn as linkBtnOf } from '@/lib/sf/ui';
import { AUTH_PATHS } from '@/lib/sf/routes';
import AuthLayout, { authErrorMessage, authErrorStyle } from './AuthLayout';
import Icon from '@/components/sf/Icon';

export default function ForgotForm() {
  const { s, set, accent } = useSF();
  const A = accent();

  const authPrimary = authPrimaryOf(A);
  const linkBtn = linkBtnOf(A);

  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const submitReset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    if (s.authEmail.indexOf('@') < 1) { setError('Enter the email address on your account.'); return; }

    setPending(true);
    setError('');
    try {
      const res = await fetch('/api/auth/password/forgot', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: s.authEmail.trim() }),
        signal: AbortSignal.timeout(15_000),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(authErrorMessage(data?.code, data?.error));
        return;
      }
      setSent(true);
    } catch {
      setError(authErrorMessage('backend_unreachable'));
    } finally {
      setPending(false);
    }
  };

  if (sent) {
    return (
      <AuthLayout mode="forgot">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '13px' }}>
          <div role="status" style={{ fontSize: '.78125rem', color: '#166534', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '10px', padding: '11px 12px', lineHeight: 1.6 }}>
            If an account exists for <strong>{s.authEmail.trim()}</strong>, a reset link is on its way.
            The link can be used once and expires in 60 minutes.
          </div>
          <Link href={AUTH_PATHS.signin} style={Object.assign({}, linkBtn, { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px' })}><Icon name="arrowLeft" size={12} />Back to sign in</Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout mode="forgot">
      <form onSubmit={submitReset} style={{ display: 'flex', flexDirection: 'column', gap: '13px' }}>
        <label style={lbl}>Work email
          <input type="email" name="email" value={s.authEmail} onChange={(e) => set({ authEmail: e.target.value })} placeholder="you@company.com" autoComplete="username" required style={authInput} />
        </label>
        {error ? <div role="alert" style={authErrorStyle}>{error}</div> : null}
        <button type="submit" disabled={pending} style={authPrimary}>{pending ? 'Sending…' : 'Send reset link'}</button>
        <Link href={AUTH_PATHS.signin} style={Object.assign({}, linkBtn, { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px' })}><Icon name="arrowLeft" size={12} />Back to sign in</Link>
      </form>
    </AuthLayout>
  );
}
