'use client';

/**
 * Shared shell for the four auth routes: the dark marketing panel, the card
 * container, the signin/signup tablist (real links), the SSO block and the
 * bottom hint row. Markup and copy are ported verbatim from the prototype's
 * combined `Auth` component.
 */

import type { CSSProperties, ReactNode } from 'react';
import Link from 'next/link';
import { useSF } from '@/lib/sf/state';
import { AUTH_TABS, AUTH_TITLES } from '@/lib/sf/data';
import { AUTH_PATHS } from '@/lib/sf/routes';
import { TEXT_MUTED, TEXT_MUTED_ON_DARK } from '@/lib/sf/ui';

export type AuthMode = 'signin' | 'signup' | 'mfa' | 'forgot' | 'reset' | 'invite';

/** Error codes returned by the handlers under `app/api/auth/*`. */
export type AuthErrorCode =
  | 'bad_request' | 'invalid_credentials' | 'forbidden' | 'not_found' | 'gone'
  | 'conflict' | 'rate_limited' | 'backend_unreachable' | 'backend_error';

/** Map an API failure onto a human sentence, preferring the server's own text. */
export function authErrorMessage(code: string | undefined, error?: string): string {
  if (error) return error;
  switch (code) {
    case 'bad_request': return 'Please check the details you entered.';
    case 'invalid_credentials': return 'Incorrect email or password.';
    case 'forbidden': return 'This account cannot sign in. Contact your administrator.';
    case 'not_found': return 'That link is not valid.';
    case 'gone': return 'That link has expired or has already been used.';
    case 'conflict': return 'An account with that email already exists.';
    case 'rate_limited': return 'Too many attempts. Please wait a moment and try again.';
    case 'backend_unreachable': return 'Cannot reach the SignForge API. Please try again in a moment.';
    case 'backend_error': return 'The SignForge API returned an unexpected error.';
    default: return 'Something went wrong. Please try again.';
  }
}

/** Inline error line shown above a form's submit button. */
export const authErrorStyle: CSSProperties = {
  fontSize: '.71875rem', color: '#9f1239', background: '#fff1f2', border: '1px solid #fecdd3',
  borderRadius: '10px', padding: '10px 11px', lineHeight: 1.55,
};

const AUTH_PROOF = [
  { label: 'Tamper-evident by default', meta: 'SHA-256 sealing, RFC 3161 timestamps and hourly ledger anchoring' },
  { label: 'Prepare in minutes', meta: 'Drag-and-drop fields, conditional logic and merge tags' },
  { label: 'Route any way you work', meta: 'Sequential, parallel, approvers and in-person signing' },
  { label: 'Audit-ready evidence', meta: 'IP, geolocation, user agent and per-field checksums' },
];

const AUTH_CERTS = ['SOC 2 Type II', 'ISO 27001', 'HIPAA', '21 CFR Part 11', 'eIDAS'];

const certStyle: CSSProperties = {
  padding: '5px 10px', borderRadius: '99px', border: '1px solid #1e293b', background: '#111c33',
  color: TEXT_MUTED_ON_DARK, fontSize: '.65625rem', fontFamily: "'Inter', 'Google Sans Flex', sans-serif",
};

const TAB_PATH: Record<string, string> = { signin: AUTH_PATHS.signin, signup: AUTH_PATHS.signup };

export default function AuthLayout({
  mode,
  title,
  subtitle,
  children,
}: {
  mode: AuthMode;
  /** Screens with no entry in `AUTH_TITLES` (reset, invite) supply their own. */
  title?: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const { accent } = useSF();
  const A = accent();

  const logoStyle: CSSProperties = {
    width: '30px', height: '30px', borderRadius: '9px', background: A, color: '#fff',
    display: 'grid', placeItems: 'center', fontSize: '.75rem', fontWeight: 700, letterSpacing: '-.5px',
  };

  const linkBtnStyle: CSSProperties = {
    background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: '.75rem', color: A, fontWeight: 500,
    textDecoration: 'none',
  };

  const authTabs = AUTH_TABS.map(([id, label]) => {
    const on = mode === id;
    return {
      id, label, href: TAB_PATH[id] || AUTH_PATHS.signin, selected: on,
      style: {
        flex: '1', height: '32px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '.8125rem',
        fontWeight: on ? 600 : 500, background: on ? '#fff' : 'transparent', color: on ? '#0f172a' : '#64748b',
        boxShadow: on ? '0 1px 2px rgba(15,23,42,.12)' : 'none',
        display: 'grid', placeItems: 'center', textDecoration: 'none',
      } as CSSProperties,
    };
  });

  const authTitles = AUTH_TITLES[mode] || AUTH_TITLES.signin;
  const authTitle = title ?? authTitles[0];
  const authSub = subtitle ?? authTitles[1];

  const authTabsVisible = mode === 'signin' || mode === 'signup';

  // SSO and passkey are not implemented on either side — there is no
  // `/api/auth/sso/start` and no WebAuthn ceremony. They are rendered disabled
  // rather than removed so the roadmap stays visible, but they cannot be
  // clicked and cannot pretend to sign anyone in.
  const ssoVisible = mode === 'signin' || mode === 'signup';
  const ssoOptions = ['Continue with SSO', 'Continue with passkey'].map(label => ({
    label,
    style: {
      height: '38px', borderRadius: '10px', border: '1px solid #eceff4', background: '#f8fafc',
      color: TEXT_MUTED, fontSize: '.78125rem', fontWeight: 600, cursor: 'not-allowed',
    } as CSSProperties,
  }));

  const authHint = mode === 'signup' ? 'No card required' : 'Protected by multi-factor authentication';
  const authSwitchLabel = mode === 'signup' ? 'Already have an account? Sign in' : 'New to SignForge? Create an account';
  const authSwitchHref = mode === 'signup' ? AUTH_PATHS.signin : AUTH_PATHS.signup;

  return (
    <div data-screen-label="Auth" style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', background: '#f5f6f8' }}>

      <div style={{ background: '#0f172a', padding: '44px 42px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '28px', overflow: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '11px' }}>
          <div style={logoStyle}>SF</div>
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
            <span style={{ color: '#f8fafc', fontWeight: 700, fontSize: '1rem', letterSpacing: '-.2px' }}>SignForge</span>
            <span style={{ color: '#64748b', fontSize: '.6875rem', fontFamily: "'Inter', 'Google Sans Flex', sans-serif" }}>ENTERPRISE E-SIGNATURE</span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '420px' }}>
          <h2 style={{ margin: 0, color: '#f8fafc', fontSize: '1.9375rem', lineHeight: 1.18, letterSpacing: '-1px', fontWeight: 700, textWrap: 'pretty' } as CSSProperties}>Agreements that execute themselves — and prove it.</h2>
          <p style={{ margin: 0, color: TEXT_MUTED_ON_DARK, fontSize: '.84375rem', lineHeight: 1.7 }}>Prepare, route and seal legally binding agreements with a tamper-evident audit trail on every field, signature and view.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '11px' }}>
            {AUTH_PROOF.map(p => (
              <div key={p.label} style={{ display: 'flex', gap: '11px', alignItems: 'flex-start' }}>
                <span style={{ width: '7px', height: '7px', borderRadius: '99px', background: '#10b981', marginTop: '6px', flex: '0 0 7px' }}></span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span style={{ color: '#e2e8f0', fontSize: '.78125rem', fontWeight: 600 }}>{p.label}</span>
                  <span style={{ color: '#64748b', fontSize: '.71875rem', lineHeight: 1.5 }}>{p.meta}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '7px', flexWrap: 'wrap' }}>
          {AUTH_CERTS.map(label => (
            <span key={label} style={certStyle}>{label}</span>
          ))}
        </div>
      </div>

      <div data-sf-scroll="1" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '36px 30px', overflow: 'auto' }}>
        <div style={{ width: '100%', maxWidth: '396px', display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {authTabsVisible ? (
            <div role="tablist" aria-label="Authentication" style={{ display: 'flex', gap: '4px', background: '#eceff4', padding: '4px', borderRadius: '11px' }}>
              {authTabs.map(t => (
                <Link key={t.id} href={t.href} role="tab" aria-selected={t.selected} style={t.style}>{t.label}</Link>
              ))}
            </div>
          ) : null}

          <div style={{ background: '#fff', border: '1px solid #e3e7ee', borderRadius: '16px', padding: '22px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ fontSize: '1.125rem', fontWeight: 700, letterSpacing: '-.4px' }}>{authTitle}</span>
              <span style={{ fontSize: '.78125rem', color: '#64748b', lineHeight: 1.5 }}>{authSub}</span>
            </div>

            {children}

            {ssoVisible ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '11px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ height: '1px', flex: 1, background: '#e3e7ee' }}></span>
                  <span style={{ fontSize: '.65625rem', color: TEXT_MUTED, fontFamily: "'Inter', 'Google Sans Flex', sans-serif" }}>OR</span>
                  <span style={{ height: '1px', flex: 1, background: '#e3e7ee' }}></span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  {ssoOptions.map(o => (
                    <button key={o.label} type="button" disabled aria-disabled="true" title="Not available yet" style={o.style}>{o.label}</button>
                  ))}
                </div>
                <span style={{ fontSize: '.65625rem', color: TEXT_MUTED, textAlign: 'center', fontFamily: "'Inter', 'Google Sans Flex', sans-serif" }}>
                  Single sign-on and passkeys are not available yet.
                </span>
              </div>
            ) : null}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '0 4px' }}>
            <span style={{ fontSize: '.6875rem', color: TEXT_MUTED, fontFamily: "'Inter', 'Google Sans Flex', sans-serif" }}>{authHint}</span>
            <Link href={authSwitchHref} style={linkBtnStyle}>{authSwitchLabel}</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
