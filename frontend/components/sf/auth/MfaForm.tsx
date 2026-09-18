'use client';

/**
 * `/login/verify` — the second factor, exchanged for a real session at
 * `POST /api/auth/mfa` (which forwards to the backend's
 * `POST /api/auth/mfa/verify` and mints the httpOnly `sf_session` cookie).
 *
 * The backend accepts either the 6-digit TOTP code or one of the user's
 * single-use recovery codes on the same field, so this screen offers both.
 */

import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSF } from '@/lib/sf/state';
import { btn, lbl, authInput, authPrimary as authPrimaryOf, linkBtn as linkBtnOf } from '@/lib/sf/ui';
import { AUTH_PATHS } from '@/lib/sf/routes';
import { clearChallenge, readChallenge, type MfaChallenge } from '@/lib/auth/mfa-challenge';
import AuthLayout, { authErrorMessage, authErrorStyle } from './AuthLayout';
import Icon from '@/components/sf/Icon';

export default function MfaForm() {
  const { s, set, flash, accent } = useSF();
  const router = useRouter();
  const A = accent();

  const authPrimary = authPrimaryOf(A);
  const linkBtn = linkBtnOf(A);
  const ghostBtn = btn('#fff', '#475569', '#e3e7ee');

  const [challenge, setChallenge] = useState<MfaChallenge | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [useRecovery, setUseRecovery] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const stored = readChallenge();
    setChallenge(stored);
    setLoaded(true);
    // No challenge in hand (direct visit, or it aged out of sessionStorage):
    // there is nothing to verify, so start again.
    if (!stored) router.replace(AUTH_PATHS.signin);
  }, [router]);

  const target = challenge?.maskedTarget || challenge?.email || 'your account';
  const mfaNote = challenge?.delivery === 'totp' || !challenge?.delivery
    ? `Enter the current 6-digit code from the authenticator app registered to ${target}.`
    : `We sent a 6-digit code to ${target}.`;
  const mfaNoteStyle: CSSProperties = { fontSize: '.71875rem', color: '#3730a3', background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: '10px', padding: '10px 11px', lineHeight: 1.55 };
  const mfaInput: CSSProperties = Object.assign({}, authInput, {
    fontFamily: 'var(--font-sans)', fontSize: '1.1875rem', letterSpacing: '.34em', textAlign: 'center' as const, height: '46px',
  });
  const recoveryInput: CSSProperties = Object.assign({}, authInput, {
    fontFamily: 'var(--font-sans)', letterSpacing: '.12em', textAlign: 'center' as const,
  });

  const verify = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || !challenge) return;

    const code = useRecovery ? recoveryCode.trim() : s.mfaCode.replace(/\D/g, '');
    if (!useRecovery && code.length !== 6) { setError('Enter the 6-digit code from your authenticator.'); return; }
    if (useRecovery && code.length < 8) { setError('Enter one of your recovery codes.'); return; }

    setPending(true);
    setError('');
    try {
      const res = await fetch('/api/auth/mfa', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mfaToken: challenge.mfaToken,
          code,
          remember: challenge.remember === true,
          next: challenge.next,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) {
        // 401 covers both a wrong code and a challenge token that has aged out
        // of its 5-minute window; the backend's own wording distinguishes them.
        const msg = authErrorMessage(data?.code, data?.error);
        setError(msg);
        if (res.status === 401 && /expired/i.test(String(data?.error ?? ''))) {
          clearChallenge();
          flash('That verification session expired — sign in again.');
          router.replace(AUTH_PATHS.signin);
          return;
        }
        if (useRecovery) setRecoveryCode(''); else set({ mfaCode: '' });
        return;
      }

      clearChallenge();
      set({ mfaCode: '', authPassword: '' });
      router.replace(typeof data.next === 'string' && data.next ? data.next : '/overview');
    } catch {
      setError(authErrorMessage('backend_unreachable'));
    } finally {
      setPending(false);
    }
  };

  const startOver = () => {
    clearChallenge();
    set({ mfaCode: '' });
  };

  if (!loaded || !challenge) {
    return (
      <AuthLayout mode="mfa">
        <div style={{ fontSize: '.78125rem', color: '#64748b' }}>Checking your sign-in…</div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout mode="mfa">
      <form onSubmit={verify} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={mfaNoteStyle}>{mfaNote}</div>

        {useRecovery ? (
          <label style={lbl}>Recovery code
            <input
              type="text" value={recoveryCode} onChange={(e) => setRecoveryCode(e.target.value)}
              autoComplete="one-time-code" placeholder="xxxx-xxxx-xxxx" aria-label="Recovery code"
              autoFocus style={recoveryInput}
            />
          </label>
        ) : (
          <label style={lbl}>6-digit code
            <input
              type="text" value={s.mfaCode} onChange={(e) => set({ mfaCode: e.target.value.replace(/\D/g, '').slice(0, 6) })}
              inputMode="numeric" maxLength={6} placeholder="123456" autoComplete="one-time-code"
              aria-label="Verification code" autoFocus style={mfaInput}
            />
          </label>
        )}

        {error ? <div role="alert" style={authErrorStyle}>{error}</div> : null}

        <div style={{ display: 'flex', gap: '8px' }}>
          <button type="submit" disabled={pending} style={authPrimary}><Icon name="shield" size={14} />{pending ? 'Verifying…' : 'Verify & sign in'}</button>
          <button
            type="button"
            onClick={() => { setError(''); setRecoveryCode(''); set({ mfaCode: '' }); setUseRecovery(v => !v); }}
            style={ghostBtn}
          >
            <Icon name={useRecovery ? 'shield' : 'key'} size={13} />{useRecovery ? 'Use authenticator' : 'Use recovery code'}
          </button>
        </div>

        <span style={{ fontSize: '.6875rem', color: '#64748b', lineHeight: 1.5 }}>
          Recovery codes work once each. Using one here leaves the rest valid.
        </span>

        <Link href={AUTH_PATHS.signin} onClick={startOver} style={Object.assign({}, linkBtn, { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px' })}><Icon name="arrowLeft" size={12} />Use a different account</Link>
      </form>
    </AuthLayout>
  );
}
