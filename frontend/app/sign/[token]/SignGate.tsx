'use client';

/**
 * The two gates the backend puts in front of the signing surface: identity
 * (one-time access code) and ESIGN consent. Until both are satisfied
 * `GET /api/sign/{token}` returns no fields and no `pdf_url`, so these are the
 * first thing a real signer sees — not an error, a designed step.
 */

import { useState, useTransition } from 'react';
import type { CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { btn, inputStyle, TEXT_MUTED } from '@/lib/sf/ui';
import { useSF } from '@/lib/sf/state';
import { SignState } from './states';
import type { SignerBranding } from './types';
import { acceptConsent, sendOtp, verifyOtp } from './actions';
import Icon from '@/components/sf/Icon';

const stack: CSSProperties = { display: 'flex', flexDirection: 'column', gap: '10px', width: '100%', marginTop: '4px' };
const row: CSSProperties = { display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' };
const note: CSSProperties = {
  margin: 0, fontSize: '.71875rem', color: TEXT_MUTED, lineHeight: 1.6,
  fontFamily: 'var(--font-sans)',
};

export function OtpGate({ token, email, brand }: { token: string; email: string; brand?: SignerBranding | null }) {
  const router = useRouter();
  /* The sender's colour, not ours: `page.tsx` wraps both gates in an
     `SFProvider` carrying it, so `accent()` is the same source the signing
     surface's own primary actions read. */
  const { accent } = useSF();
  const [pending, startTransition] = useTransition();
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const brandColor = accent();
  const brandText = brand?.primary_text_color ?? '#fff';
  const primary = btn(brandColor, brandText, brandColor);
  const ghost = btn('#fff', '#475569', '#e3e7ee');

  const send = () => startTransition(async () => {
    const result = await sendOtp(token);
    setMessage(result.ok ? 'Access code sent to ' + email : result.message);
  });
  const verify = () => startTransition(async () => {
    const result = await verifyOtp(token, code.trim());
    if (!result.ok) { setMessage(result.message); return; }
    setMessage(null);
    router.refresh();
  });

  return (
    <SignState
      tone="info"
      label="Identity check"
      brand={brand}
      title="Confirm it is you"
      body={'This envelope is protected with a one-time access code. We will send it to ' + email + ', then you can start signing.'}
    >
      <div style={stack}>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          inputMode="numeric"
          aria-label="Access code"
          placeholder="6-digit code"
          style={{ ...inputStyle, height: '38px', textAlign: 'center', letterSpacing: '.3em' }}
        />
        <div style={row}>
          <button type="button" onClick={send} disabled={pending} style={ghost}><Icon name="send" size={13} />Send code</button>
          <button type="button" onClick={verify} disabled={pending || code.trim().length < 4} style={primary}><Icon name="shield" size={13} />Verify and continue</button>
        </div>
        {message ? <p style={note}>{message}</p> : null}
      </div>
    </SignState>
  );
}

export function ConsentGate({
  token, signerName, documentTitle, consentVersion, brand,
}: {
  token: string; signerName: string; documentTitle: string; consentVersion: string;
  brand?: SignerBranding | null;
}) {
  const router = useRouter();
  const { accent } = useSF();
  const [pending, startTransition] = useTransition();
  const [agreed, setAgreed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const brandColor = accent();
  const primary = btn(brandColor, brand?.primary_text_color ?? '#fff', brandColor);

  const accept = () => startTransition(async () => {
    const result = await acceptConsent(token);
    if (!result.ok) { setMessage(result.message); return; }
    router.refresh();
  });

  return (
    <SignState
      tone="info"
      brand={brand}
      label={'Disclosure v' + consentVersion}
      title="Electronic Record and Signature Disclosure"
      body={signerName + ', before you can open ' + documentTitle + ' you need to agree to sign electronically. Your electronic signature has the same legal effect as a handwritten one, and every action is recorded in a tamper-evident audit trail with its own SHA-256 checksum.'}
    >
      <div style={stack}>
        <label style={{ display: 'flex', gap: '9px', alignItems: 'flex-start', textAlign: 'left', fontSize: '.78125rem', color: '#475569', lineHeight: 1.6 }}>
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            style={{ marginTop: '3px', width: '15px', height: '15px', flex: '0 0 15px', accentColor: brandColor }}
          />
          <span>I agree to transact business electronically and to use electronic records and signatures for this envelope. I may request a paper copy from the sender at any time.</span>
        </label>
        <div style={row}>
          <button type="button" onClick={accept} disabled={pending || !agreed} style={primary}><Icon name="check" size={13} />Agree and review document</button>
        </div>
        {message ? <p style={note}>{message}</p> : null}
      </div>
    </SignState>
  );
}
