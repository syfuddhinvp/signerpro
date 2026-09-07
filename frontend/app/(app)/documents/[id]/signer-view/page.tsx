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
import { isAnnotationType } from '@/lib/sf/annotations';
import { documentPathFor } from '@/lib/sf/routes';
import { isSealedStatus } from '@/lib/sf/sealed';
import type { FieldResponse, RecipientResponse } from '@/lib/api/types';
import ApiUnavailable from '@/components/sf/ApiUnavailable';

export const metadata: Metadata = { title: 'Signer view · SignerPro' };

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

  /* The sender's own marks are not anybody's fields: they are shown to every
     recipient and never offered as an input, so they are split out here the
     same way the public signing session splits them out (ANN-1). */
  const annotationFields = apiFields.filter(f => isAnnotationType(f.type));
  const annotations = annotationFields.map(f => ({
    id: f.id, type: f.type, page_number: f.page_number,
    x: Number(f.x), y: Number(f.y), width: Number(f.width), height: Number(f.height),
    default_value: f.default_value, options: f.options,
  }));
  const inputFields = apiFields.filter(f => !isAnnotationType(f.type));
  const assigned = toSignerFields(inputFields).filter(f => !previewed || f.to === previewed.id);
  // The real document, through the session proxy — the same bytes the recipient
  // is served, so the preview is a preview rather than a mock-up (audit C2).
  const pdfUrl = `/api/proxy/documents/${document.id}/pdf`;
  // Everyone else's placements, greyed out, exactly as the recipient sees them.
  const others = toSignerFields(inputFields)
    .filter(f => previewed && f.to !== previewed.id)
    .map(f => ({ id: f.id, type: f.apiType, page_number: f.page, x: f.x, y: f.y, width: f.w, height: f.h }));

  /* Field counts per recipient, so the preview's recipient chips say how much
     each of them is actually being asked to do. */
  const allFields = toSignerFields(inputFields);
  const previewRecipients = recipientList.map(r => ({
    id: r.id,
    name: r.name,
    role: r.role,
    fieldCount: allFields.filter(f => f.to === r.id).length,
  }));

  return (
    <>
      {!fieldsResult.ok || !recipientsResult.ok ? (
        <div style={{ padding: '22px 22px 0' }}>
          <ApiUnavailable what="This document's fields and recipients" detail={(fieldsResult.ok ? null : fieldsResult.error.message) ?? (recipientsResult.ok ? null : recipientsResult.error.message)} />
        </div>
      ) : null}
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
          annotations={annotations}
          viewOnly={previewed ? previewed.role === 'copy' : false}
        />
      </SignerPreview>    </>
  
  );
}
