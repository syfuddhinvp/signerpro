'use client';

/**
 * `/login` — real sign-in against `POST /api/auth/login`, which sets the
 * httpOnly `sf_session` cookie and answers `{ ok, user, next }`.
 * Markup and copy are ported verbatim from the prototype's combined `Auth`.
 */

import { useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSF } from '@/lib/sf/state';
import { AUTH_ROLES } from '@/lib/sf/data';
import { lbl, authInput, authPrimary as authPrimaryOf, linkBtn as linkBtnOf } from '@/lib/sf/ui';
import { AUTH_PATHS } from '@/lib/sf/routes';
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

  const authRoles = AUTH_ROLES.map(([id, label, meta]) => {
    const on = s.authRole === id;
    return {
      id, label, meta, selected: on ? 'true' : 'false',
      onClick: () => set({ authRole: id }),
      style: {
        display: 'flex', flexDirection: 'column', gap: '3px', alignItems: 'flex-start', padding: '10px 11px',
        borderRadius: '11px', cursor: 'pointer', border: '1px solid ' + (on ? A : '#dfe4ec'),
        background: on ? '#eef2ff' : '#fbfcfd',
      } as CSSProperties,
    };
  });

  const rememberRow: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: '8px', background: 'none', border: 'none', padding: 0, cursor: 'pointer' };
  const rememberBox: CSSProperties = {
    width: '17px', height: '17px', borderRadius: '5px', display: 'grid', placeItems: 'center', fontSize: '11px',
    color: '#fff', flex: '0 0 17px', border: '1px solid ' + (s.remember ? A : '#cbd5e1'), background: s.remember ? A : '#fff',
  };
  const rememberMark = s.remember ? '✓' : '';

  const submitSignin = async () => {
    if (pending) return;
    if (s.authEmail.indexOf('@') < 1) { flash('Enter a valid work email'); return; }
    if (s.authPassword.length < 6) { flash('Enter your password (any 6+ characters in this prototype)'); return; }

    setPending(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: s.authEmail, password: s.authPassword, next: params.get('next') || undefined }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        const msg = authErrorMessage(data?.code, data?.error);
        setError(msg);
        flash(msg);
        return;
      }
      set({ authPassword: '', mfaCode: '' });
      router.replace(data.next);
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: '13px' }}>
        <label style={lbl}>Work email
          <input type="email" value={s.authEmail} onChange={(e) => set({ authEmail: e.target.value })} placeholder="you@company.com" autoComplete="username" style={authInput} />
        </label>
        <label style={lbl}>Password
          <input type="password" value={s.authPassword} onChange={(e) => set({ authPassword: e.target.value })} placeholder="••••••••••" autoComplete="current-password" style={authInput} />
        </label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
          <span style={lbl}>Sign in as</span>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            {authRoles.map(r => (
              <button key={r.id} type="button" onClick={r.onClick} aria-pressed={r.selected === 'true'} style={r.style}>
                <span style={{ fontSize: '12.5px', fontWeight: 600 }}>{r.label}</span>
                <span style={{ fontSize: '10.5px', color: '#64748b', fontFamily: "'Inter', 'Google Sans Flex', sans-serif" }}>{r.meta}</span>
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
          <button type="button" role="switch" aria-checked={s.remember} onClick={() => set({ remember: !s.remember })} style={rememberRow}>
            <span style={rememberBox}>{rememberMark}</span>
            <span style={{ fontSize: '12px', color: '#334155' }}>Remember this device</span>
          </button>
          <Link href={AUTH_PATHS.forgot} style={linkStyle}>Forgot password?</Link>
        </div>
        {error ? <div role="alert" style={authErrorStyle}>{error}</div> : null}
        <button type="button" onClick={submitSignin} disabled={pending} style={authPrimary}>{pending ? 'Signing in…' : 'Continue'}</button>
      </div>
    </AuthLayout>
  );
}
