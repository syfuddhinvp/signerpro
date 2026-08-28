'use client';

import type { CSSProperties } from 'react';
import { useSF, passwordScore } from '@/lib/sf/state';
import {
  AUTH_TABS, AUTH_ROLES, AUTH_TITLES, STRENGTH_COLORS, STRENGTH_WORDS,
} from '@/lib/sf/data';
import { btn, lbl, authInput, authPrimary as authPrimaryOf, linkBtn as linkBtnOf } from '@/lib/sf/ui';

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

export default function Auth() {
  const { s, set, flash, accent } = useSF();
  const A = accent();

  const authPrimary = authPrimaryOf(A);
  const linkBtn = linkBtnOf(A);
  const ghostBtn = btn('#fff', '#475569', '#e3e7ee');

  const logoStyle: CSSProperties = {
    width: '30px', height: '30px', borderRadius: '9px', background: A, color: '#fff',
    display: 'grid', placeItems: 'center', fontSize: '12px', fontWeight: 700, letterSpacing: '-.5px',
  };

  const pw = s.reg.password;
  const score = passwordScore(pw);

  const authTabs = AUTH_TABS.map(([id, label]) => {
    const on = s.authMode === id;
    return {
      id, label, selected: on ? 'true' : 'false',
      onClick: () => set({ authMode: id }),
      style: {
        flex: '1', height: '32px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '13px',
        fontWeight: on ? 600 : 500, background: on ? '#fff' : 'transparent', color: on ? '#0f172a' : '#64748b',
        boxShadow: on ? '0 1px 2px rgba(15,23,42,.12)' : 'none',
      } as CSSProperties,
    };
  });

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

  const enterApp = (role: string) => {
    const plat = role === 'platform';
    set({
      authed: true, workspace: plat ? 'platform' : 'tenant', screen: plat ? 'platformHome' : 'tenantHome',
      mfaCode: '', authPassword: '',
      user: plat ? { name: 'Jordan Mehta', role: 'Platform · Super admin' } : { name: 'Priya Raman', role: 'Acme Corp · Org admin' },
    });
    flash(plat ? 'Signed in as super admin · elevated session 15 min' : 'Signed in to Acme Corporation');
  };

  const authTitles = AUTH_TITLES[s.authMode] || AUTH_TITLES.signin;
  const authTitle = authTitles[0];
  const authSub = authTitles[1];

  const authTabsVisible = s.authMode === 'signin' || s.authMode === 'signup';
  const authSignin = s.authMode === 'signin';
  const authSignup = s.authMode === 'signup';
  const authMfa = s.authMode === 'mfa';
  const authForgot = s.authMode === 'forgot';
  const ssoVisible = s.authMode === 'signin' || s.authMode === 'signup';

  const rememberRow: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: '8px', background: 'none', border: 'none', padding: 0, cursor: 'pointer' };
  const rememberBox: CSSProperties = {
    width: '17px', height: '17px', borderRadius: '5px', display: 'grid', placeItems: 'center', fontSize: '11px',
    color: '#fff', flex: '0 0 17px', border: '1px solid ' + (s.remember ? A : '#cbd5e1'), background: s.remember ? A : '#fff',
  };
  const rememberMark = s.remember ? '✓' : '';

  const submitSignin = () => {
    if (s.authEmail.indexOf('@') < 1) { flash('Enter a valid work email'); return; }
    if (s.authPassword.length < 6) { flash('Enter your password (any 6+ characters in this prototype)'); return; }
    set({ authMode: 'mfa' });
  };
  const submitMfa = () => {
    if (s.mfaCode.replace(/\D/g, '').length !== 6) { flash('Enter the 6-digit code (any digits work here)'); return; }
    enterApp(s.authRole);
  };
  const usePasskey = () => enterApp(s.authRole);
  const backToSignin = () => set({ authMode: 'signin', mfaCode: '' });
  const mfaNote = 'Code sent to the authenticator registered to ' + s.authEmail + '. Any 6 digits are accepted in this prototype.';
  const mfaNoteStyle: CSSProperties = { fontSize: '11.5px', color: '#3730a3', background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: '10px', padding: '10px 11px', lineHeight: 1.55 };
  const mfaInput: CSSProperties = Object.assign({}, authInput, {
    fontFamily: "'Inter', 'Google Sans Flex', sans-serif", fontSize: '19px', letterSpacing: '.34em', textAlign: 'center' as const, height: '46px',
  });
  const submitReset = () => { set({ authMode: 'signin' }); flash('Reset link sent to ' + s.authEmail + ' · valid 30 minutes'); };

  const strengthBars = [0, 1, 2, 3].map(i => ({
    style: { flex: '1', height: '4px', borderRadius: '99px', background: i < score ? STRENGTH_COLORS[score] : '#eef1f6' } as CSSProperties,
  }));
  const strengthLabel = STRENGTH_WORDS[score];
  const strengthLabelStyle: CSSProperties = { fontSize: '11px', color: score >= 3 ? '#047857' : (score === 0 ? '#94a3b8' : '#c2410c') };

  const termsRow: CSSProperties = { display: 'flex', alignItems: 'flex-start', gap: '9px', background: 'none', border: 'none', padding: 0, cursor: 'pointer' };
  const termsBox: CSSProperties = {
    width: '17px', height: '17px', borderRadius: '5px', display: 'grid', placeItems: 'center', fontSize: '11px', color: '#fff',
    flex: '0 0 17px', marginTop: '1px', border: '1px solid ' + (s.reg.terms ? A : '#cbd5e1'), background: s.reg.terms ? A : '#fff',
  };
  const termsMark = s.reg.terms ? '✓' : '';
  const toggleTerms = () => set(st => ({ reg: Object.assign({}, st.reg, { terms: !st.reg.terms }) }));

  const submitSignup = () => {
    const r = s.reg;
    if (!r.name.trim() || !r.company.trim()) { flash('Name and company are required'); return; }
    if (r.email.indexOf('@') < 1) { flash('Enter a valid work email'); return; }
    if (score < 2) { flash('Choose a stronger password — 12+ characters with a number'); return; }
    if (!r.terms) { flash('Accept the terms and disclosure to continue'); return; }
    set({ authed: true, workspace: 'tenant', screen: 'tenantHome', user: { name: r.name.trim(), role: r.company.trim() + ' · Owner' } });
    flash('Workspace created for ' + r.company.trim() + ' · 14-day Business trial started');
  };

  const ssoOptions = ([['Continue with SSO', 'sso'], ['Continue with passkey', 'passkey']] as [string, string][]).map(([label, kind]) => ({
    label,
    onClick: () => {
      if (kind === 'sso') { set({ authMode: 'mfa' }); flash('Redirected to Okta · SAML assertion returned'); }
      else enterApp(s.authRole);
    },
    style: { height: '38px', borderRadius: '10px', border: '1px solid #dfe4ec', background: '#fff', color: '#334155', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer' } as CSSProperties,
  }));

  const authHint = s.authMode === 'signup' ? 'No card required' : 'Prototype · any password and 6-digit code';
  const authSwitchLabel = s.authMode === 'signup' ? 'Already have an account? Sign in' : 'New to SignForge? Create an account';
  const switchAuthMode = () => set({ authMode: s.authMode === 'signup' ? 'signin' : 'signup' });

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
                <button key={t.id} type="button" role="tab" aria-selected={t.selected === 'true'} onClick={t.onClick} style={t.style}>{t.label}</button>
              ))}
            </div>
          ) : null}

          <div style={{ background: '#fff', border: '1px solid #e3e7ee', borderRadius: '16px', padding: '22px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ fontSize: '18px', fontWeight: 700, letterSpacing: '-.4px' }}>{authTitle}</span>
              <span style={{ fontSize: '12.5px', color: '#64748b', lineHeight: 1.5 }}>{authSub}</span>
            </div>

            {authSignin ? (
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
                  <button type="button" onClick={() => set({ authMode: 'forgot' })} style={linkBtn}>Forgot password?</button>
                </div>
                <button type="button" onClick={submitSignin} style={authPrimary}>Continue</button>
              </div>
            ) : null}

            {authSignup ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '13px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '9px' }}>
                  <label style={lbl}>Full name
                    <input type="text" value={s.reg.name} onChange={(e) => { const v = e.target.value; set(st => ({ reg: Object.assign({}, st.reg, { name: v }) })); }} placeholder="Priya Raman" autoComplete="name" style={authInput} />
                  </label>
                  <label style={lbl}>Company
                    <input type="text" value={s.reg.company} onChange={(e) => { const v = e.target.value; set(st => ({ reg: Object.assign({}, st.reg, { company: v }) })); }} placeholder="Acme Corporation" autoComplete="organization" style={authInput} />
                  </label>
                </div>
                <label style={lbl}>Work email
                  <input type="email" value={s.reg.email} onChange={(e) => { const v = e.target.value; set(st => ({ reg: Object.assign({}, st.reg, { email: v }) })); }} placeholder="you@company.com" autoComplete="email" style={authInput} />
                </label>
                <label style={lbl}>Password
                  <input type="password" value={s.reg.password} onChange={(e) => { const v = e.target.value; set(st => ({ reg: Object.assign({}, st.reg, { password: v }) })); }} placeholder="At least 12 characters" autoComplete="new-password" style={authInput} />
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ display: 'flex', gap: '5px' }}>
                    {strengthBars.map((b, i) => (<span key={i} style={b.style}></span>))}
                  </div>
                  <span style={strengthLabelStyle}>{strengthLabel}</span>
                </div>
                <label style={lbl}>Company size
                  <select value={s.reg.size} onChange={(e) => { const v = e.target.value; set(st => ({ reg: Object.assign({}, st.reg, { size: v }) })); }} style={authInput}>
                    <option value="1-50">1–50 employees</option>
                    <option value="51-500">51–500 employees</option>
                    <option value="501-5000">501–5,000 employees</option>
                    <option value="5000+">5,000+ employees</option>
                  </select>
                </label>
                <button type="button" role="checkbox" aria-checked={s.reg.terms} onClick={toggleTerms} style={termsRow}>
                  <span style={termsBox}>{termsMark}</span>
                  <span style={{ fontSize: '11.5px', color: '#475569', lineHeight: 1.5, textAlign: 'left' }}>I agree to the Terms of Service, the Electronic Record and Signature Disclosure, and the DPA.</span>
                </button>
                <button type="button" onClick={submitSignup} style={authPrimary}>Create account</button>
              </div>
            ) : null}

            {authMfa ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div style={mfaNoteStyle}>{mfaNote}</div>
                <label style={lbl}>6-digit code
                  <input type="text" value={s.mfaCode} onChange={(e) => set({ mfaCode: e.target.value })} inputMode="numeric" maxLength={6} placeholder="123456" aria-label="Verification code" style={mfaInput} />
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button type="button" onClick={submitMfa} style={authPrimary}>Verify &amp; sign in</button>
                  <button type="button" onClick={usePasskey} style={ghostBtn}>Use passkey</button>
                </div>
                <button type="button" onClick={backToSignin} style={linkBtn}>← Use a different account</button>
              </div>
            ) : null}

            {authForgot ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '13px' }}>
                <label style={lbl}>Work email
                  <input type="email" value={s.authEmail} onChange={(e) => set({ authEmail: e.target.value })} placeholder="you@company.com" style={authInput} />
                </label>
                <button type="button" onClick={submitReset} style={authPrimary}>Send reset link</button>
                <button type="button" onClick={backToSignin} style={linkBtn}>← Back to sign in</button>
              </div>
            ) : null}

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
            <button type="button" onClick={switchAuthMode} style={linkBtn}>{authSwitchLabel}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
