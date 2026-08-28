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
import { notFound } from 'next/navigation';
import Signer from '@/components/sf/screens/Signer';
import { serverCaller } from '@/lib/api/client';
import { documents as documentsApi, fields as fieldsApi, recipients as recipientsApi } from '@/lib/api/resources';
import { toSignerFields, toSignerRecipients, toSignValues } from '@/lib/sf/adapters';
import { documentPathFor } from '@/lib/sf/routes';
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
  // Nothing placed yet: the store's authoring fields keep the designed surface
  // intact instead of rendering blank paper.
  if (!assigned.length) return <Signer />;

  return (
    <Signer
      fields={assigned}
      recipients={recipientList}
      pageCount={document.page_count || 1}
      initialValues={toSignValues(assigned)}
    />
  );
}
