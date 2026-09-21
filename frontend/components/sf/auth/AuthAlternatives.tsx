'use client';

/**
 * The "OR" block under the sign-in and sign-up forms: single sign-on and
 * passkeys.
 *
 * Both are second doors into the same session. Neither is a form of its own —
 * each reveals the one field it needs when its button is pressed, because the
 * common case is a password user who should not be asked for a workspace slug
 * they have never seen.
 *
 * SSO leaves the app entirely (browser navigation to the IdP and back through
 * `/api/auth/sso/acs`), so it never resolves here. The passkey ceremony does,
 * and ends exactly where the password form ends: a redirect, or the MFA
 * challenge screen when the account has a second factor confirmed.
 */

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { useSF } from '@/lib/sf/state';
import { authInput, lbl } from '@/lib/sf/ui';
import { TEXT_MUTED } from '@/lib/sf/ui';
import { AUTH_PATHS } from '@/lib/sf/routes';
import { storeChallenge } from '@/lib/auth/mfa-challenge';
import { credentialToJson, passkeysSupported, toRequestOptions } from '@/lib/sf/webauthn';
import { authErrorMessage, authErrorStyle } from './AuthLayout';
import Icon from '@/components/sf/Icon';

type Panel = 'sso' | 'passkey' | null;

/** What the ACS and login-start routes redirect back with when they give up. */
const SSO_RETURN_MESSAGES: Record<string, string> = {
  unknown: 'That workspace does not use single sign-on.',
  failed: 'Your identity provider did not complete the sign-in. Please try again.',
  unreachable: 'Cannot reach the SignerPro API. Please try again in a moment.',
};

export default function AuthAlternatives() {
  const { accent, flash } = useSF();
  const { s } = useSF();
  const router = useRouter();
  const A = accent();

  const [panel, setPanel] = useState<Panel>(null);
  const [slug, setSlug] = useState('');
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const fieldRef = useRef<HTMLInputElement | null>(null);

  // Read from `location` rather than `useSearchParams` so this component does
  // not impose a Suspense boundary on every screen that renders it.
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('sso');
    if (code && SSO_RETURN_MESSAGES[code]) setError(SSO_RETURN_MESSAGES[code]);
  }, []);

  useEffect(() => { if (panel) fieldRef.current?.focus(); }, [panel]);

  const buttonStyle = (active: boolean): CSSProperties => ({
    height: '38px', borderRadius: '10px', background: active ? 'hsl(var(--color-accent-subtle))' : 'hsl(var(--color-bg-subtle))',
    border: '1px solid ' + (active ? A : 'hsl(var(--color-border-default))'), color: active ? A : TEXT_MUTED,
    fontSize: '.78125rem', fontWeight: 600, cursor: pending ? 'progress' : 'pointer',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '7px',
  });

  const continueStyle: CSSProperties = {
    height: '34px', borderRadius: '9px', border: 'none', background: A, color: 'hsl(var(--color-fg-on-solid))',
    fontSize: '.75rem', fontWeight: 600, cursor: pending ? 'progress' : 'pointer', padding: '0 14px',
  };

  const open = (which: Exclude<Panel, null>) => {
    setError('');
    setPanel(current => (current === which ? null : which));
    if (which === 'passkey' && !email) setEmail(s.authEmail || '');
  };

  const fail = (message: string) => { setError(message); flash(message); };

  const startSso = () => {
    const clean = slug.trim().toLowerCase();
    if (!clean) { fail('Enter your workspace name.'); return; }
    setPending(true);
    // A full navigation, not a fetch: the IdP needs the browser, and the
    // round trip ends at the ACS route, which mints the cookie itself.
    window.location.href = `/api/auth/sso/login/${encodeURIComponent(clean)}`;
  };

  const startPasskey = async () => {
    const address = email.trim();
    if (address.indexOf('@') < 1) { fail('Enter a valid work email.'); return; }
    if (!passkeysSupported()) {
      fail('This browser does not support passkeys.');
      return;
    }

    setPending(true);
    setError('');
    try {
      const begun = await fetch('/api/auth/passkey/begin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: address }),
        signal: AbortSignal.timeout(15_000),
      });
      const options = await begun.json().catch(() => null);
      if (!begun.ok || !options?.ok) { fail(authErrorMessage(options?.code, options?.error)); return; }

      let assertion: PublicKeyCredential | null;
      try {
        assertion = (await navigator.credentials.get({
          publicKey: toRequestOptions(options.options),
        })) as PublicKeyCredential | null;
      } catch {
        // `NotAllowedError` covers both "the user cancelled" and "no matching
        // credential", and the browser deliberately does not distinguish them.
        fail('No passkey was used. Try again, or sign in with your password.');
        return;
      }
      if (!assertion) { fail('No passkey was used. Try again, or sign in with your password.'); return; }

      const next = new URLSearchParams(window.location.search).get('next') || undefined;
      const res = await fetch('/api/auth/passkey/finish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: address, credential: credentialToJson(assertion), next }),
        signal: AbortSignal.timeout(15_000),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) { fail(authErrorMessage(data?.code, data?.error)); return; }

      if (data.mfaRequired === true) {
        storeChallenge({
          mfaToken: data.mfaToken,
          delivery: typeof data.delivery === 'string' ? data.delivery : 'totp',
          maskedTarget: typeof data.maskedTarget === 'string' ? data.maskedTarget : '',
          email: address,
          remember: false,
          next,
        });
        router.replace(AUTH_PATHS.mfa);
        return;
      }
      router.replace(typeof data.next === 'string' && data.next ? data.next : '/overview');
    } catch {
      fail(authErrorMessage('backend_unreachable'));
    } finally {
      setPending(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '11px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ height: '1px', flex: 1, background: 'hsl(var(--color-border-subtle))' }}></span>
        <span style={{ fontSize: '.65625rem', color: TEXT_MUTED, fontFamily: 'var(--font-sans)' }}>OR</span>
        <span style={{ height: '1px', flex: 1, background: 'hsl(var(--color-border-subtle))' }}></span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        <button type="button" onClick={() => open('sso')} disabled={pending} aria-expanded={panel === 'sso'} style={buttonStyle(panel === 'sso')}>
          <Icon name="shield" size={13} />Continue with SSO
        </button>
        <button type="button" onClick={() => open('passkey')} disabled={pending} aria-expanded={panel === 'passkey'} style={buttonStyle(panel === 'passkey')}>
          <Icon name="key" size={13} />Continue with passkey
        </button>
      </div>

      {panel === 'sso' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <label style={lbl}>Workspace
            <input
              ref={fieldRef} value={slug} onChange={e => setSlug(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); startSso(); } }}
              placeholder="acme" autoComplete="organization" style={authInput}
            />
          </label>
          <button type="button" onClick={startSso} disabled={pending} style={continueStyle}>
            {pending ? 'Redirecting…' : 'Continue to your identity provider'}
          </button>
        </div>
      ) : null}

      {panel === 'passkey' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <label style={lbl}>Work email
            <input
              ref={fieldRef} type="email" value={email} onChange={e => setEmail(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void startPasskey(); } }}
              placeholder="you@company.com" autoComplete="username webauthn" style={authInput}
            />
          </label>
          <button type="button" onClick={() => void startPasskey()} disabled={pending} style={continueStyle}>
            {pending ? 'Waiting for your passkey…' : 'Use your passkey'}
          </button>
        </div>
      ) : null}

      {error ? <div role="alert" style={authErrorStyle}>{error}</div> : null}
    </div>
  );
}
