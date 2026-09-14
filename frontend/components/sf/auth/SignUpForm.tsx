'use client';

/**
 * `/register` — real registration against `POST /api/auth/register`, which
 * creates the organization, sets the httpOnly `sf_session` cookie and answers
 * `{ ok, user, next }`. Markup and copy ported verbatim from the prototype.
 */

import { useState, type CSSProperties } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSF, passwordScore } from '@/lib/sf/state';
import { STRENGTH_COLORS, STRENGTH_WORDS } from '@/lib/sf/data';
import { lbl, authInput, authPrimary as authPrimaryOf, BORDER_STRONG, TEXT_MUTED } from '@/lib/sf/ui';
import AuthLayout, { authErrorMessage, authErrorStyle } from './AuthLayout';
import Icon from '@/components/sf/Icon';

export default function SignUpForm() {
  const { s, set, flash, accent } = useSF();
  const router = useRouter();
  const params = useSearchParams();
  const A = accent();

  const authPrimary = authPrimaryOf(A);

  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const pw = s.reg.password;
  const score = passwordScore(pw);

  const strengthBars = [0, 1, 2, 3].map(i => ({
    style: { flex: '1', height: '4px', borderRadius: '99px', background: i < score ? STRENGTH_COLORS[score] : '#eef1f6' } as CSSProperties,
  }));
  const strengthLabel = STRENGTH_WORDS[score];
  const strengthLabelStyle: CSSProperties = { fontSize: '.6875rem', color: score >= 3 ? '#047857' : (score === 0 ? TEXT_MUTED : '#c2410c') };

  const termsRow: CSSProperties = { display: 'flex', alignItems: 'flex-start', gap: '9px', background: 'none', border: 'none', padding: 0, cursor: 'pointer' };
  const termsBox: CSSProperties = {
    width: '17px', height: '17px', borderRadius: '5px', display: 'grid', placeItems: 'center', fontSize: '.6875rem', color: '#fff',
    flex: '0 0 17px', marginTop: '1px', border: '1px solid ' + (s.reg.terms ? A : BORDER_STRONG), background: s.reg.terms ? A : '#fff',
  };
  const toggleTerms = () => set(st => ({ reg: Object.assign({}, st.reg, { terms: !st.reg.terms }) }));

  const submitSignup = async () => {
    if (pending) return;
    const r = s.reg;
    if (!r.name.trim() || !r.company.trim()) { flash('Name and company are required'); return; }
    if (r.email.indexOf('@') < 1) { flash('Enter a valid work email'); return; }
    if (score < 2) { flash('Choose a stronger password — 12+ characters with a number'); return; }
    if (!r.terms) { flash('Accept the terms and disclosure to continue'); return; }

    setPending(true);
    setError('');
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          organizationName: r.company.trim(),
          name: r.name.trim(),
          email: r.email.trim(),
          password: r.password,
          next: params.get('next') || undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        const msg = authErrorMessage(data?.code, data?.error);
        setError(msg);
        flash(msg);
        return;
      }
      set(st => ({ reg: Object.assign({}, st.reg, { password: '', terms: false }) }));
      flash('Workspace created for ' + r.company.trim() + ' · 14-day Business trial started');
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
    <AuthLayout mode="signup">
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
          <span style={termsBox}>{s.reg.terms ? <Icon name="check" size={11} /> : null}</span>
          <span style={{ fontSize: '.71875rem', color: '#475569', lineHeight: 1.5, textAlign: 'left' }}>I agree to the Terms of Service, the Electronic Record and Signature Disclosure, and the DPA.</span>
        </button>
        {error ? <div role="alert" style={authErrorStyle}>{error}</div> : null}
        <button type="button" onClick={submitSignup} disabled={pending} style={authPrimary}>{pending ? 'Creating account…' : 'Create account'}</button>
      </div>
    </AuthLayout>
  );
}
