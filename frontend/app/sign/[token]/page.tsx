/**
 * The public signing route — the only screen in the app a recipient without an
 * account ever reaches. `middleware.ts` lets `/sign/*` through unauthenticated;
 * the credential is the signing token in the URL, so the session is bootstrapped
 * server-side with `apiFetchPublic` (no session token is sent, and none exists).
 *
 *   GET /api/sign/{token}  →  document, assigned fields, consent state,
 *                             read_only, can_decline, can_reassign
 *
 * Everything that can go wrong with a link — invalid, revoked, expired, envelope
 * closed, not this recipient's turn, rate-limited, backend down — resolves to a
 * designed state (`states.tsx`) instead of an exception.
 */

import type { Metadata } from 'next';
import { apiFetchPublic } from '@/lib/api/client';
import { toSignerFields, toSignValues } from '@/lib/sf/adapters';
import { CONTACT_PALETTE } from '@/lib/sf/data';
import type { Recipient } from '@/lib/sf/state';
import SignSurface from './SignSurface';
import { ConsentGate, OtpGate } from './SignGate';
import { SignState, TokenProblemState } from './states';
import { tokenProblemFor, type SigningSessionResponse } from './types';

export const metadata: Metadata = { title: 'Sign · SignForge' };
export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const result = await apiFetchPublic<SigningSessionResponse>(`/api/sign/${encodeURIComponent(token)}`);

  if (!result.ok) {
    const problem = tokenProblemFor(result.error.status, result.error.message);
    return <TokenProblemState problem={problem} detail={result.error.message} />;
  }

  const session = result.data;
  const signerName = session.recipient.name;
  const documentTitle = session.document.title;

  // Gate 1 — identity. No fields and no PDF are returned until it is cleared.
  if (session.otp_required) {
    return <OtpGate token={token} email={session.recipient.email} />;
  }

  // Gate 2 — ESIGN consent, same deal.
  if (session.consent_required) {
    return (
      <ConsentGate
        token={token}
        signerName={signerName}
        documentTitle={documentTitle}
        consentVersion={session.consent_version || '1.0'}
      />
    );
  }

  const assignedIds = new Set(
    session.assigned_field_ids.length
      ? session.assigned_field_ids
      : session.fields.filter(f => f.recipient_id === session.current_recipient_id).map(f => f.id),
  );
  const assigned = toSignerFields(session.fields).filter(f => assignedIds.has(f.id));

  // Already finished: the envelope is read-only, so this is the completion
  // state rather than a signing surface the signer cannot use.
  if (session.read_only) {
    return (
      <SignState
        tone="good"
        label="Signing complete"
        title={'You have signed ' + documentTitle}
        body={'Thank you, ' + signerName + '. Your signature is sealed into the envelope with a SHA-256 hash and recorded in its tamper-evident audit trail. The sender will email the completed copy once every recipient has signed.'}
        detail={session.required_total ? `${session.required_completed} of ${session.required_total} required fields completed` : null}
      />
    );
  }

  if (!assigned.length) {
    return (
      <SignState
        tone="info"
        label="Nothing to complete"
        title={'No fields are assigned to you on ' + documentTitle}
        body={'You have been given access to this envelope, but the sender has not placed any fields for you. Contact them if you expected something to sign.'}
      />
    );
  }

  /**
   * The signer themself, as the field tags' colour source. The public session
   * intentionally exposes no other recipient's details, so this is a
   * single-entry list.
   *
   * FALLBACK: `PublicRecipient` carries no colour (the public schema omits it),
   * so the first palette entry stands in.
   */
  const me: Recipient = {
    id: session.current_recipient_id,
    name: signerName,
    email: session.recipient.email,
    role: session.recipient.role_name ?? 'sign',
    color: CONTACT_PALETTE[0],
    order: 1,
    status: 'Viewed',
  };

  return (
    <SignSurface
      token={token}
      fields={assigned}
      recipients={[me]}
      initialValues={toSignValues(assigned)}
      pageCount={session.document.page_count || 1}
      readOnly={false}
      canDecline={session.can_decline}
      canReassign={session.can_reassign}
      signerName={signerName}
      documentTitle={documentTitle}
      pdfHref={`/sign/${encodeURIComponent(token)}/pdf`}
      consentVersion={session.consent_version || '1.0'}
    />
  );
}
