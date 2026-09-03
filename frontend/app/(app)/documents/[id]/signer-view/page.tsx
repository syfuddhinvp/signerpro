/**
 * Signer experience — the *sender's* preview of what a recipient will see, for
 * the envelope named by the `[id]` route param.
 *
 * The same `Signer` surface the public route at `/sign/[token]` renders, fed
 * from the authenticated document endpoints instead of a signing token: the
 * fields assigned to the first signing recipient, that recipient's colours, and
 * whatever values have already been saved. Nothing here mutates — the preview
 * keeps the prototype's in-app modal flow.
 *
 * `?recipient=<id>` still selects which recipient is previewed; that is a view
 * option on this document, not the document's identity.
 */

import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import Signer from '@/components/sf/screens/Signer';
import SignerPreview from '@/components/sf/screens/SignerPreview';
import { serverCaller } from '@/lib/api/client';
import { documents as documentsApi, fields as fieldsApi, recipients as recipientsApi } from '@/lib/api/resources';
import { toSignerFields, toSignerRecipients, toSignValues } from '@/lib/sf/adapters';
import { documentPathFor } from '@/lib/sf/routes';
import { isSealedStatus } from '@/lib/sf/sealed';
import type { FieldResponse, RecipientResponse } from '@/lib/api/types';

export const metadata: Metadata = { title: 'Signer view · SignForge' };

type SearchParams = { recipient?: string };

export default async function Page({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<SearchParams>;
}) {
  const { id: documentId } = await params;
  const query = (await searchParams) ?? {};
  const api = serverCaller(documentPathFor('sign', documentId));

  const documentResult = await documentsApi.get(api, documentId);
  if (!documentResult.ok) notFound();
  const document = documentResult.data;

  /* Previewing "what the recipient will see" has no meaning once they have
     seen it and signed: the envelope is sealed and its trail is the record. */
  if (isSealedStatus(document.status)) redirect(documentPathFor('audit', documentId));

  const [fieldsResult, recipientsResult] = await Promise.all([
    fieldsApi.list(api, document.id),
    recipientsApi.list(api, document.id),
  ]);

  const apiFields: FieldResponse[] = fieldsResult.ok ? fieldsResult.data : [];
  const apiRecipients: RecipientResponse[] = recipientsResult.ok ? recipientsResult.data : [];
  const recipientList = toSignerRecipients(apiRecipients);

  // Preview the first signer in the routing order (or an explicit ?recipient=).
  const previewed = query.recipient
    ? recipientList.find(r => r.id === query.recipient)
    : (recipientList.find(r => r.role === 'sign') ?? recipientList[0]);

  const assigned = toSignerFields(apiFields).filter(f => !previewed || f.to === previewed.id);
  // The real document, through the session proxy — the same bytes the recipient
  // is served, so the preview is a preview rather than a mock-up (audit C2).
  const pdfUrl = `/api/proxy/documents/${document.id}/pdf`;
  // Everyone else's placements, greyed out, exactly as the recipient sees them.
  const others = toSignerFields(apiFields)
    .filter(f => previewed && f.to !== previewed.id)
    .map(f => ({ id: f.id, type: f.apiType, page_number: f.page, x: f.x, y: f.y, width: f.w, height: f.h }));

  /* Field counts per recipient, so the preview's recipient chips say how much
     each of them is actually being asked to do. */
  const allFields = toSignerFields(apiFields);
  const previewRecipients = recipientList.map(r => ({
    id: r.id,
    name: r.name,
    role: r.role,
    fieldCount: allFields.filter(f => f.to === r.id).length,
  }));

  return (
    <SignerPreview
      documentId={document.id}
      recipients={previewRecipients}
      selectedId={previewed ? previewed.id : null}
    >
      <Signer
        fields={assigned}
        recipients={recipientList}
        pageCount={document.page_count || 1}
        title={document.title}
        initialValues={toSignValues(assigned)}
        pdfUrl={pdfUrl}
        otherPlacements={others}
        viewOnly={previewed ? previewed.role === 'copy' : false}
      />
    </SignerPreview>
  );
}
