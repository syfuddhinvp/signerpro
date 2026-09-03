'use client';

/**
 * `/invite/<token>` — the landing page for the link `invitation_service` emails
 * (`{app_base_url}/invite/{token}`).
 *
 * The backend exposes no public "describe this invitation" endpoint, so the
 * details it can show before redemption are only what the link itself carries.
 * Redemption goes through `POST /api/auth/invitation/accept` →
 * `POST /api/invitations/accept`, which creates the member account and answers
 * with a session, so the new member lands signed in.
 *
 * The three dead-link states the backend distinguishes are kept distinct here:
 *   404 — no such invitation (revoked, or a mistyped link)
 *   410 — already accepted, or expired
 *   409 — that email already has an account (sign in instead)
 */

import { useState, type CSSProperties, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSF, passwordScore } from '@/lib/sf/state';
import { STRENGTH_COLORS, STRENGTH_WORDS } from '@/lib/sf/data';
import { lbl, authInput, authPrimary as authPrimaryOf, linkBtn as linkBtnOf, TEXT_MUTED } from '@/lib/sf/ui';
import { AUTH_PATHS } from '@/lib/sf/routes';
import AuthLayout, { authErrorMessage, authErrorStyle } from './AuthLayout';

type DeadState = 'not_found' | 'gone' | 'conflict';

const DEAD_COPY: Record<DeadState, { title: string; body: string; cta: 'signin' | 'none' }> = {
  not_found: {
    title: 'This invitation is no longer valid',
    body: 'It may have been revoked by an administrator, or the link was copied incompletely. Ask whoever invited you to send a new one.',
    cta: 'none',
  },
  gone: {
    title: 'This invitation has expired',
    body: 'Invitations can be accepted once, and only before they expire. Ask your administrator to invite you again.',
    cta: 'none',
  },
  conflict: {
    title: 'You already have an account',
    body: 'That email address is already registered on SignForge. Sign in with it instead — an administrator can add you to the workspace directly.',
    cta: 'signin',
  },
};

export default function InviteForm({ token }: { token: string }) {
  const { flash, accent } = useSF();
  const router = useRouter();
  const A = accent();

  const authPrimary = authPrimaryOf(A);
  const linkBtn = linkBtnOf(A);
  const linkStyle: CSSProperties = Object.assign({}, linkBtn, { textDecoration: 'none' });

  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [dead, setDead] = useState<DeadState | null>(null);

  const score = passwordScore(password);
  const strengthBars = [0, 1, 2, 3].map(i => ({
    style: { flex: '1', height: '4px', borderRadius: '99px', background: i < score ? STRENGTH_COLORS[score] : '#eef1f6' } as CSSProperties,
  }));
  const strengthLabelStyle: CSSProperties = { fontSize: '.6875rem', color: score >= 3 ? '#047857' : (score === 0 ? TEXT_MUTED : '#c2410c') };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    if (name.trim().length < 2) { setError('Enter your full name.'); return; }
    if (password.length < 8) { setError('Choose a password of at least 8 characters.'); return; }

    setPending(true);
    setError('');
    try {
      const res = await fetch('/api/auth/invitation/accept', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, name: name.trim(), password }),
        signal: AbortSignal.timeout(15_000),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        const code = data?.code;
        if (code === 'not_found' || code === 'gone' || code === 'conflict') {
          setDead(code);
          return;
        }
        setError(authErrorMessage(code, data?.error));
        return;
      }
      const org = data.user?.organizationName;
      flash(org ? `Welcome to ${org}` : 'Welcome to SignForge');
      router.replace(typeof data.next === 'string' && data.next ? data.next : '/overview');
    } catch {
      setError(authErrorMessage('backend_unreachable'));
    } finally {
      setPending(false);
    }
  };

  if (!token) {
    return (
      <AuthLayout mode="invite" title="Invitation link incomplete" subtitle="There is no invitation token in this link.">
        <div role="alert" style={authErrorStyle}>
          Copy the full link from the invitation email, including everything after <code>/invite/</code>.
        </div>
      </AuthLayout>
    );
  }

  if (dead) {
    const copy = DEAD_COPY[dead];
    return (
      <AuthLayout mode="invite" title={copy.title} subtitle="Nothing was changed on your account.">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '13px' }}>
          <div role="alert" style={authErrorStyle}>{copy.body}</div>
          {copy.cta === 'signin' ? <Link href={AUTH_PATHS.signin} style={linkStyle}>Sign in instead</Link> : null}
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      mode="invite"
      title="Accept your invitation"
      subtitle="Set a name and password to join the workspace you were invited to."
    >
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '13px' }}>
        <div style={{ fontSize: '.71875rem', color: '#3730a3', background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: '10px', padding: '10px 11px', lineHeight: 1.55 }}>
          Your account will be created for the email address the invitation was sent to, with the role the
          administrator chose. Invitations can be accepted once.
        </div>
        <label style={lbl}>Full name
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Priya Raman" autoComplete="name" required style={authInput} />
        </label>
        <label style={lbl}>Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 12 characters" autoComplete="new-password" required style={authInput} />
        </label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', gap: '5px' }}>
            {strengthBars.map((b, i) => (<span key={i} style={b.style}></span>))}
          </div>
          <span style={strengthLabelStyle}>{STRENGTH_WORDS[score]}</span>
        </div>
        {error ? <div role="alert" style={authErrorStyle}>{error}</div> : null}
        <button type="submit" disabled={pending} style={authPrimary}>{pending ? 'Joining…' : 'Accept invitation'}</button>
        <Link href={AUTH_PATHS.signin} style={linkStyle}>← Already have an account? Sign in</Link>
      </form>
    </AuthLayout>
  );
}
