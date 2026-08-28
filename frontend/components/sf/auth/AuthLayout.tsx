'use client';

/**
 * Shared shell for the four auth routes: the dark marketing panel, the card
 * container, the signin/signup tablist (real links), the SSO block and the
 * bottom hint row. Markup and copy are ported verbatim from the prototype's
 * combined `Auth` component.
 */

import type { CSSProperties, ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSF } from '@/lib/sf/state';
import { AUTH_TABS, AUTH_TITLES } from '@/lib/sf/data';
import { AUTH_PATHS } from '@/lib/sf/routes';

export type AuthMode = 'signin' | 'signup' | 'mfa' | 'forgot';

/** Error codes returned by `app/api/auth/{login,register}/route.ts`. */
export type AuthErrorCode =
  | 'bad_request' | 'invalid_credentials' | 'conflict' | 'backend_unreachable' | 'backend_error';

/** Map an API failure onto a human sentence, preferring the server's own text. */
export function authErrorMessage(code: string | undefined, error?: string): string {
  if (error) return error;
  switch (code) {
    case 'bad_request': return 'Please check the details you entered.';
    case 'invalid_credentials': return 'Incorrect email or password.';
    case 'conflict': return 'An account with that email already exists.';
    case 'backend_unreachable': return 'Cannot reach the SignForge API. Please try again in a moment.';
    case 'backend_error': return 'The SignForge API returned an unexpected error.';
    default: return 'Something went wrong. Please try again.';
  }
}

/** Inline error line shown above a form's submit button. */
export const authErrorStyle: CSSProperties = {
  fontSize: '11.5px', color: '#9f1239', background: '#fff1f2', border: '1px solid #fecdd3',
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
  color: '#94a3b8', fontSize: '10.5px', fontFamily: "'Inter', 'Google Sans Flex', sans-serif",
};

const TAB_PATH: Record<string, string> = { signin: AUTH_PATHS.signin, signup: AUTH_PATHS.signup };

export default function AuthLayout({ mode, children }: { mode: AuthMode; children: ReactNode }) {
  const { flash, accent } = useSF();
  const router = useRouter();
  const A = accent();

  const logoStyle: CSSProperties = {
    width: '30px', height: '30px', borderRadius: '9px', background: A, color: '#fff',
    display: 'grid', placeItems: 'center', fontSize: '12px', fontWeight: 700, letterSpacing: '-.5px',
  };

  const linkBtnStyle: CSSProperties = {
    background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: '12px', color: A, fontWeight: 500,
    textDecoration: 'none',
  };

  const authTabs = AUTH_TABS.map(([id, label]) => {
    const on = mode === id;
    return {
      id, label, href: TAB_PATH[id] || AUTH_PATHS.signin, selected: on,
      style: {
        flex: '1', height: '32px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '13px',
        fontWeight: on ? 600 : 500, background: on ? '#fff' : 'transparent', color: on ? '#0f172a' : '#64748b',
        boxShadow: on ? '0 1px 2px rgba(15,23,42,.12)' : 'none',
        display: 'grid', placeItems: 'center', textDecoration: 'none',
      } as CSSProperties,
    };
  });

  const authTitles = AUTH_TITLES[mode] || AUTH_TITLES.signin;
  const authTitle = authTitles[0];
  const authSub = authTitles[1];

  const authTabsVisible = mode === 'signin' || mode === 'signup';
  const ssoVisible = mode === 'signin' || mode === 'signup';

  const ssoOptions = ([['Continue with SSO', 'sso'], ['Continue with passkey', 'passkey']] as [string, string][]).map(([label, kind]) => ({
    label,
    onClick: () => {
      if (kind === 'sso') {
        // TODO: SAML/OIDC handshake — will redirect to `/api/auth/sso/start`.
        flash('Redirected to Okta · SAML assertion returned');
        router.push(AUTH_PATHS.mfa);
      } else {
        // TODO: WebAuthn assertion — will POST `/api/auth/passkey`.
        flash('Redirected to Okta · SAML assertion returned');
        router.push(AUTH_PATHS.mfa);
      }
    },
    style: { height: '38px', borderRadius: '10px', border: '1px solid #dfe4ec', background: '#fff', color: '#334155', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer' } as CSSProperties,
  }));

  const authHint = mode === 'signup' ? 'No card required' : 'Prototype · any password and 6-digit code';
  const authSwitchLabel = mode === 'signup' ? 'Already have an account? Sign in' : 'New to SignForge? Create an account';
  const authSwitchHref = mode === 'signup' ? AUTH_PATHS.signin : AUTH_PATHS.signup;

  return (
    <div data-screen-label="Auth" style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', background: '#f5f6f8' }}>

      <div style={{ background: '#0f172a', padding: '44px 42px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '28px', overflow: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '11px' }}>
          <div style={logoStyle}>SF</div>
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
            <span style={{ color: '#f8fafc', fontWeight: 700, fontSize: '16px', letterSpacing: '-.2px' }}>SignForge</span>
            <span style={{ color: '#64748b', fontSize: '11px', fontFamily: "'Inter', 'Google Sans Flex', sans-serif" }}>ENTERPRISE E-SIGNATURE</span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '420px' }}>
          <h2 style={{ margin: 0, color: '#f8fafc', fontSize: '31px', lineHeight: 1.18, letterSpacing: '-1px', fontWeight: 700, textWrap: 'pretty' } as CSSProperties}>Agreements that execute themselves — and prove it.</h2>
          <p style={{ margin: 0, color: '#94a3b8', fontSize: '13.5px', lineHeight: 1.7 }}>Prepare, route and seal legally binding agreements with a tamper-evident audit trail on every field, signature and view.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '11px' }}>
            {AUTH_PROOF.map(p => (
              <div key={p.label} style={{ display: 'flex', gap: '11px', alignItems: 'flex-start' }}>
                <span style={{ width: '7px', height: '7px', borderRadius: '99px', background: '#10b981', marginTop: '6px', flex: '0 0 7px' }}></span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span style={{ color: '#e2e8f0', fontSize: '12.5px', fontWeight: 600 }}>{p.label}</span>
                  <span style={{ color: '#64748b', fontSize: '11.5px', lineHeight: 1.5 }}>{p.meta}</span>
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
              <span style={{ fontSize: '18px', fontWeight: 700, letterSpacing: '-.4px' }}>{authTitle}</span>
              <span style={{ fontSize: '12.5px', color: '#64748b', lineHeight: 1.5 }}>{authSub}</span>
            </div>

            {children}

            {ssoVisible ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '11px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ height: '1px', flex: 1, background: '#e3e7ee' }}></span>
                  <span style={{ fontSize: '10.5px', color: '#94a3b8', fontFamily: "'Inter', 'Google Sans Flex', sans-serif" }}>OR</span>
                  <span style={{ height: '1px', flex: 1, background: '#e3e7ee' }}></span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  {ssoOptions.map(o => (
                    <button key={o.label} type="button" onClick={o.onClick} style={o.style}>{o.label}</button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '0 4px' }}>
            <span style={{ fontSize: '11px', color: '#94a3b8', fontFamily: "'Inter', 'Google Sans Flex', sans-serif" }}>{authHint}</span>
            <Link href={authSwitchHref} style={linkBtnStyle}>{authSwitchLabel}</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
