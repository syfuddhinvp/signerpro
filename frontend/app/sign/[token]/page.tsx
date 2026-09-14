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
import { SFProvider } from '@/lib/sf/state';
import { toSignerFields, toSignValues } from '@/lib/sf/adapters';
import { CONTACT_PALETTE } from '@/lib/sf/data';
import type { Recipient } from '@/lib/sf/state';
import Signer from '@/components/sf/screens/Signer';
import SignSurface from './SignSurface';
import { ConsentGate, OtpGate } from './SignGate';
import { SignState, TokenProblemState } from './states';
import { tokenProblemFor, type SigningSessionResponse } from './types';

export const metadata: Metadata = { title: 'Sign · SignerPro' };
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

  /* The sender's brand colour drives every primary action a signer presses
     (ORG-7). A nested provider rather than a prop threaded through five
     screens: `accent()` is already the one place the whole design system asks
     for this colour, and the root provider has no token to resolve it from.
     An unbranded tenant passes `undefined` and gets SignerPro's own accent. */
  const branded = (node: React.ReactNode) => (
    <SFProvider accent={session.branding?.primary_color ?? undefined}>{node}</SFProvider>
  );

  // Gate 1 — identity. No fields and no PDF are returned until it is cleared.
  if (session.otp_required) {
    return branded(<OtpGate token={token} email={session.recipient.email} brand={session.branding} />);
  }

  // Gate 2 — ESIGN consent, same deal.
  if (session.consent_required) {
    return branded(
      <ConsentGate
        token={token}
        signerName={signerName}
        documentTitle={documentTitle}
        consentVersion={session.consent_version || '1.0'}
        brand={session.branding}
      />
    );
  }

  const assignedIds = new Set(
    session.assigned_field_ids.length
      ? session.assigned_field_ids
      : session.fields.filter(f => f.recipient_id === session.current_recipient_id).map(f => f.id),
  );
  const assigned = toSignerFields(session.fields).filter(f => assignedIds.has(f.id));

  const pdfHref = `/sign/${encodeURIComponent(token)}/pdf`;

  /**
   * A `copy` (CC) recipient. Their session comes back `read_only` with no
   * ceremony attached — they are entitled to *read the document*, which is the
   * whole point of being copied on it. Falling through to the completion state
   * below would tell them "You have signed …", which they have not.
   */
  if (session.recipient.role === 'copy') {
    return branded(
      <Signer
        viewOnly
        readOnly
        pdfUrl={pdfHref}
        pageCount={session.document.page_count || 1}
        otherPlacements={session.other_field_placements ?? []}
        annotations={session.annotations ?? []}
        onDownload={undefined}
      />
    );
  }

  // Already finished: the envelope is read-only, so this is the completion
  // state rather than a signing surface the signer cannot use.
  if (session.read_only) {
    return branded(
      <SignState
        brand={session.branding}
        tone="good"
        label="Signing complete"
        title={'You have signed ' + documentTitle}
        body={'Thank you, ' + signerName + '. Your signature is sealed into the envelope with a SHA-256 hash and recorded in its tamper-evident audit trail. The sender will email the completed copy once every recipient has signed.'}
        detail={session.required_total ? `${session.required_completed} of ${session.required_total} required fields completed` : null}
      />
    );
  }

  if (!assigned.length) {
    return branded(
      <SignState
        brand={session.branding}
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
   * FALLBACK: `PublicRecipient` carries no colour (the public schema omits it).
   * The sender's brand colour stands in rather than a palette entry: a signer
   * sees exactly one recipient's tags — their own — so the palette buys no
   * distinction here and only puts a second, unrelated colour on a branded
   * page. An unbranded tenant falls back to the first palette entry.
   */
  const me: Recipient = {
    id: session.current_recipient_id,
    name: signerName,
    email: session.recipient.email,
    role: session.recipient.role,
    color: session.branding?.primary_color ?? CONTACT_PALETTE[0],
    order: 1,
    status: 'Viewed',
  };

  return branded(
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
      pdfHref={pdfHref}
      consentVersion={session.consent_version || '1.0'}
      otherPlacements={session.other_field_placements ?? []}
      annotations={session.annotations ?? []}
    />
  );
}
