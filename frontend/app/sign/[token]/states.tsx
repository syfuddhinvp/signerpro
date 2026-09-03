/**
 * Every terminal state a public signing link can land in, as one designed card.
 *
 * A signer who follows a dead link is not a developer: they get the same
 * SignForge card the app's own error boundaries use, saying what happened and
 * what to do next — never a stack trace, and never a crash.
 */

import type { CSSProperties, ReactNode } from 'react';
import {
  fallbackBody, fallbackCard, fallbackCode, fallbackMark, fallbackPage, fallbackTitle,
} from '@/lib/sf/fallback';
import type { TokenProblem } from './types';

const chip = (bg: string, fg: string, bd: string): CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 9px', borderRadius: '99px',
  background: bg, color: fg, border: '1px solid ' + bd, fontSize: '.71875rem', fontWeight: 600,
});

const TONE: Record<string, CSSProperties> = {
  good: chip('#ecfdf5', '#047857', '#a7f3d0'),
  warn: chip('#fff7ed', '#c2410c', '#fed7aa'),
  bad: chip('#fef2f2', '#b91c1c', '#fecaca'),
  info: chip('#eef2ff', '#4338ca', '#c7d2fe'),
};

export function SignState({
  tone = 'info', label, title, body, detail, children,
}: {
  tone?: keyof typeof TONE;
  label: string;
  title: string;
  body: string;
  detail?: string | null;
  children?: ReactNode;
}) {
  return (
    <main style={fallbackPage}>
      <div style={fallbackCard}>
        <div style={fallbackMark}>SF</div>
        <span style={TONE[tone]}>{label}</span>
        <h1 style={fallbackTitle}>{title}</h1>
        <p style={fallbackBody}>{body}</p>
        {detail ? <p style={fallbackCode}>{detail}</p> : null}
        {children}
      </div>
    </main>
  );
}

const COPY: Record<TokenProblem, { tone: keyof typeof TONE; label: string; title: string; body: string }> = {
  invalid: {
    tone: 'bad', label: 'Link not recognised', title: 'This signing link is not valid',
    body: 'The link may have been truncated by an email client, or the envelope it pointed at has been deleted. Ask the sender to resend your invitation.',
  },
  revoked: {
    tone: 'warn', label: 'Link superseded', title: 'This signing link has been replaced',
    body: 'A newer invitation was issued for this envelope, which retires every earlier link. Open the most recent email from the sender to continue signing.',
  },
  expired: {
    tone: 'warn', label: 'Link expired', title: 'This signing link has expired',
    body: 'Signing links are time-limited for security. Ask the sender to send a reminder — a fresh link arrives immediately and your progress is kept.',
  },
  unavailable: {
    tone: 'bad', label: 'Envelope closed', title: 'This envelope is no longer open for signing',
    body: 'It was voided, expired or declined, so no further signatures can be collected. The sender has the full audit trail and can start a new envelope.',
  },
  waiting: {
    tone: 'info', label: 'Not your turn yet', title: 'This envelope is waiting on an earlier signer',
    body: 'The routing order has not reached you. You will be emailed the moment it does — nothing is needed from you right now.',
  },
  throttled: {
    tone: 'warn', label: 'Too many attempts', title: 'Please try again in a moment',
    body: 'This link was opened many times in quick succession. Wait a minute and reload — the envelope itself is unaffected.',
  },
  unreachable: {
    tone: 'bad', label: 'Service unavailable', title: 'SignForge could not load this envelope',
    body: 'The signing service did not respond. Nothing you have signed has been lost; reload in a moment to pick up exactly where you left off.',
  },
};

export function TokenProblemState({ problem, detail }: { problem: TokenProblem; detail?: string | null }) {
  const copy = COPY[problem];
  return <SignState tone={copy.tone} label={copy.label} title={copy.title} body={copy.body} detail={detail} />;
}
