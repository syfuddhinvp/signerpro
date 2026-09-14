/**
 * Terminal states for a framed embed session.
 *
 * The audience here is two people at once: the end user staring at a blank
 * panel inside their CRM, and the developer who wired the iframe up. So each
 * card says what the user should do *and* names the API condition that caused
 * it, which is the thing the integrator needs and cannot see from outside the
 * frame.
 */

import type { CSSProperties, ReactNode } from 'react';
import {
  fallbackBody, fallbackCard, fallbackCode, fallbackMark, fallbackPage, fallbackTitle,
} from '@/lib/sf/fallback';

const chip = (bg: string, fg: string, bd: string): CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 9px', borderRadius: '99px',
  background: bg, color: fg, border: '1px solid ' + bd, fontSize: '.71875rem', fontWeight: 600,
});

const TONE: Record<string, CSSProperties> = {
  warn: chip('#fff7ed', '#c2410c', '#fed7aa'),
  bad: chip('#fef2f2', '#b91c1c', '#fecaca'),
  info: chip('#eef2ff', '#4338ca', '#c7d2fe'),
};

export function EmbedState({
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

/** Which card a `GET /api/embed/context` failure earns. */
export type EmbedProblem = 'missing' | 'invalid' | 'expired' | 'empty' | 'unreachable';

export function embedProblemFor(status: number): EmbedProblem {
  if (status === 404) return 'invalid';
  if (status === 410) return 'expired';
  return 'unreachable';
}

const COPY: Record<EmbedProblem, { tone: keyof typeof TONE; label: string; title: string; body: string; hint: string }> = {
  missing: {
    tone: 'bad', label: 'No session', title: 'This embed URL carries no session',
    body: 'The preparation surface can only be framed with a session minted for it. Nothing has been loaded and no data was exposed.',
    hint: 'Expected /embed/{landing}?session=… — use the `url` returned once by POST /api/embed/sessions.',
  },
  invalid: {
    tone: 'bad', label: 'Session not recognised', title: 'This embed session is not valid',
    body: 'The token does not match any session. It may have been truncated in transit, or the document it pointed at has since been deleted.',
    hint: 'GET /api/embed/context returned 404. Mint a fresh session server-side and reload the frame.',
  },
  expired: {
    tone: 'warn', label: 'Session expired', title: 'This embed session has expired',
    body: 'Embed sessions are deliberately short-lived. Ask the host application to open the document again — a new session is issued instantly.',
    hint: 'GET /api/embed/context returned 410. Sessions live for `ttl_minutes` (default 30, max 1440) from creation.',
  },
  empty: {
    tone: 'info', label: 'Nothing to prepare', title: 'This session names no document',
    body: 'The session was created without a document or template, so there is nothing to lay fields out on.',
    hint: 'Pass document.document_id, document.template_id or a recipient_id when calling POST /api/embed/sessions.',
  },
  unreachable: {
    tone: 'bad', label: 'Service unavailable', title: 'SignerPro could not load this session',
    body: 'The API did not respond. Nothing has been lost — reload the frame in a moment.',
    hint: 'GET /api/embed/context did not return a response.',
  },
};

export function EmbedProblemState({ problem, detail }: { problem: EmbedProblem; detail?: string | null }) {
  const copy = COPY[problem];
  return (
    <EmbedState tone={copy.tone} label={copy.label} title={copy.title} body={copy.body} detail={detail || copy.hint} />
  );
}
