'use client';

/**
 * `/reset-password?token=…` — the landing page for the link the backend emails
 * (`auth_service.forgot_password` builds `{app_base_url}/reset-password?token=`).
 *
 * `POST /api/auth/password/reset` redeems the token, rotates the password and
 * answers with a full session, so a successful reset lands the user signed in.
 * The token is single-use and expires after 60 minutes; an invalid or expired
 * one comes back as a 400 with the backend's own wording.
 */

import { useState, type CSSProperties, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSF, passwordScore } from '@/lib/sf/state';
import { STRENGTH_COLORS, STRENGTH_WORDS } from '@/lib/sf/data';
import { lbl, authInput, authPrimary as authPrimaryOf, linkBtn as linkBtnOf, TEXT_MUTED } from '@/lib/sf/ui';
import { AUTH_PATHS } from '@/lib/sf/routes';
import AuthLayout, { authErrorMessage, authErrorStyle } from './AuthLayout';
import Icon from '@/components/sf/Icon';

export default function ResetPasswordForm() {
  const { flash, accent } = useSF();
  const router = useRouter();
  const params = useSearchParams();
  const A = accent();

  const token = params.get('token') ?? '';
  const authPrimary = authPrimaryOf(A);
  const linkBtn = linkBtnOf(A);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const score = passwordScore(password);
  const strengthBars = [0, 1, 2, 3].map(i => ({
    style: { flex: '1', height: '4px', borderRadius: '99px', background: i < score ? STRENGTH_COLORS[score] : '#eef1f6' } as CSSProperties,
  }));
  const strengthLabelStyle: CSSProperties = { fontSize: '.6875rem', color: score >= 3 ? '#047857' : (score === 0 ? TEXT_MUTED : '#c2410c') };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    if (password.length < 8) { setError('Choose a password of at least 8 characters.'); return; }
    if (password !== confirm) { setError('The two passwords do not match.'); return; }

    setPending(true);
    setError('');
    try {
      const res = await fetch('/api/auth/password/reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, password }),
        signal: AbortSignal.timeout(15_000),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(authErrorMessage(data?.code, data?.error));
        return;
      }
      flash('Password updated · all other sessions signed out');
      router.replace(typeof data.next === 'string' && data.next ? data.next : '/overview');
    } catch {
      setError(authErrorMessage('backend_unreachable'));
    } finally {
      setPending(false);
    }
  };

  if (!token) {
    return (
      <AuthLayout mode="reset" title="Reset your password" subtitle="This link is incomplete.">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '13px' }}>
          <div role="alert" style={authErrorStyle}>
            This reset link is missing its token. Request a new one — links can be used once and expire after 60 minutes.
          </div>
          <Link href={AUTH_PATHS.forgot} style={Object.assign({}, linkBtn, { textDecoration: 'none' })}>Request a new reset link</Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout mode="reset" title="Choose a new password" subtitle="This link works once and expires 60 minutes after it was sent.">
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '13px' }}>
        <label style={lbl}>New password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 12 characters" autoComplete="new-password" required style={authInput} />
        </label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', gap: '5px' }}>
            {strengthBars.map((b, i) => (<span key={i} style={b.style}></span>))}
          </div>
          <span style={strengthLabelStyle}>{STRENGTH_WORDS[score]}</span>
        </div>
        <label style={lbl}>Confirm password
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Repeat the password" autoComplete="new-password" required style={authInput} />
        </label>
        {error ? <div role="alert" style={authErrorStyle}>{error}</div> : null}
        <button type="submit" disabled={pending} style={authPrimary}><Icon name="key" size={14} />{pending ? 'Updating…' : 'Set new password'}</button>
        <Link href={AUTH_PATHS.signin} style={Object.assign({}, linkBtn, { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px' })}><Icon name="arrowLeft" size={12} />Back to sign in</Link>
      </form>
    </AuthLayout>
  );
}
