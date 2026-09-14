/**
 * The framed preparation surface — the other half of the embed flow.
 *
 * A host application mints a session server-side (`POST /api/embed/sessions`,
 * API-7), gets back a single-use `url`, and drops that url into an iframe.
 * This is the page that url points at.
 *
 *   GET /api/embed/context?token=…  →  session, document, fields, recipients
 *
 * Three things make this route unlike every other page in the app:
 *
 *  1. **The token is the credential.** There is no `sf_session` here — the
 *     person looking at this frame is a user of the *host's* product, not of
 *     ours. `middleware.ts` lets `/embed/*` through unauthenticated for the
 *     same reason it lets `/sign/*` through.
 *  2. **Framing is the point, so framing is enforced.** `middleware.ts` emits
 *     `Content-Security-Policy: frame-ancestors` built from this session's own
 *     tenant allowlist. That is the only enforceable answer to "who may embed
 *     us": `allowed_origins` names host applications, and a host application
 *     never sends us a request whose `Origin` we could check.
 *  3. **It reads, it does not author.** The document, field placements and
 *     injected contacts are real and are rendered as the signer will see them.
 *     Interactive authoring from inside the frame needs the document and field
 *     routes to accept an embed principal (they take `get_current_user` only),
 *     which is deliberately not done here rather than half-done.
 */

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Signer from '@/components/sf/screens/Signer';
import { apiFetchPublic } from '@/lib/api/client';
import EmbedFrame from './EmbedFrame';
import { EmbedProblemState, embedProblemFor } from './states';
import { LANDINGS, type EmbedContextResponse, type EmbedLanding } from './types';

export const metadata: Metadata = { title: 'Embedded session · SignerPro', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ landing: string }>;
  searchParams: Promise<{ session?: string }>;
}) {
  const { landing } = await params;
  const { session: token } = await searchParams;

  // `builder | routing | signing` — anything else was never a real embed url.
  if (!LANDINGS.includes(landing as EmbedLanding)) notFound();

  if (!token || token.length < 10) return <EmbedProblemState problem="missing" />;

  const result = await apiFetchPublic<EmbedContextResponse>('/api/embed/context', { query: { token } });
  if (!result.ok) {
    return <EmbedProblemState problem={embedProblemFor(result.error.status)} detail={result.error.message} />;
  }

  const { session, document, fields, recipients } = result.data;

  // A session minted with no document or template. Legal, and useless to frame.
  if (!document) return <EmbedProblemState problem="empty" />;

  /* The contacts the host injected when minting the session. A session created
     from a document alone injects none, so the envelope's own recipients stand
     in — the bar's job is to show who this document is for either way. */
  const injected = (session.contacts ?? []).map(c => c.name || c.email || '').filter(Boolean);
  const contacts = injected.length ? injected : recipients.map(r => r.name);

  return (
    <EmbedFrame
      title={document.title}
      landing={landing as EmbedLanding}
      sessionId={session.id}
      externalId={session.external_id}
      returnUrl={session.return_url}
      contacts={contacts}
      expiresAt={session.expires_at}
    >
      <Signer
        viewOnly
        readOnly
        title={document.title}
        pdfUrl={`/embed/${landing}/pdf?session=${encodeURIComponent(token)}`}
        pageCount={Math.max(1, document.page_count || 1)}
        otherPlacements={fields.map(f => ({
          id: f.id,
          type: f.type,
          page_number: f.page_number,
          x: Number(f.x),
          y: Number(f.y),
          width: Number(f.width),
          height: Number(f.height),
        }))}
        annotations={[]}
        onDownload={undefined}
      />
    </EmbedFrame>
  );
}
