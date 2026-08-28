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
import { btn, inputStyle } from '@/lib/sf/ui';
import { SignState } from './states';
import { acceptConsent, sendOtp, verifyOtp } from './actions';

const stack: CSSProperties = { display: 'flex', flexDirection: 'column', gap: '10px', width: '100%', marginTop: '4px' };
const row: CSSProperties = { display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' };
const note: CSSProperties = {
  margin: 0, fontSize: '11.5px', color: '#94a3b8', lineHeight: 1.6,
  fontFamily: "'Inter', 'Google Sans Flex', sans-serif",
};

export function OtpGate({ token, email }: { token: string; email: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const primary = btn('#4f46e5', '#fff', '#4f46e5');
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
          <button type="button" onClick={send} disabled={pending} style={ghost}>Send code</button>
          <button type="button" onClick={verify} disabled={pending || code.trim().length < 4} style={primary}>Verify and continue</button>
        </div>
        {message ? <p style={note}>{message}</p> : null}
      </div>
    </SignState>
  );
}

export function ConsentGate({
  token, signerName, documentTitle, consentVersion,
}: { token: string; signerName: string; documentTitle: string; consentVersion: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [agreed, setAgreed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const primary = btn('#4f46e5', '#fff', '#4f46e5');

  const accept = () => startTransition(async () => {
    const result = await acceptConsent(token);
    if (!result.ok) { setMessage(result.message); return; }
    router.refresh();
  });

  return (
    <SignState
      tone="info"
      label={'Disclosure v' + consentVersion}
      title="Electronic Record and Signature Disclosure"
      body={signerName + ', before you can open ' + documentTitle + ' you need to agree to sign electronically. Your electronic signature has the same legal effect as a handwritten one, and every action is recorded in a tamper-evident audit trail with its own SHA-256 checksum.'}
    >
      <div style={stack}>
        <label style={{ display: 'flex', gap: '9px', alignItems: 'flex-start', textAlign: 'left', fontSize: '12.5px', color: '#475569', lineHeight: 1.6 }}>
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            style={{ marginTop: '3px', width: '15px', height: '15px', flex: '0 0 15px' }}
          />
          <span>I agree to transact business electronically and to use electronic records and signatures for this envelope. I may request a paper copy from the sender at any time.</span>
        </label>
        <div style={row}>
          <button type="button" onClick={accept} disabled={pending || !agreed} style={primary}>Agree and review document</button>
        </div>
        {message ? <p style={note}>{message}</p> : null}
      </div>
    </SignState>
  );
}
