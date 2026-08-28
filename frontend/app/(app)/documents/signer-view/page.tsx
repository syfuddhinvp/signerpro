/**
 * Signer experience — the *sender's* preview of what a recipient will see.
 *
 * The same `Signer` surface the public route at `/sign/[token]` renders, fed
 * from the authenticated document endpoints instead of a signing token: the
 * fields assigned to the first signing recipient, that recipient's colours, and
 * whatever values have already been saved. Nothing here mutates — the preview
 * keeps the prototype's in-app modal flow.
 *
 * Envelope resolution: `?document=<id>`, newest document otherwise.
 */

import type { Metadata } from 'next';
import Signer from '@/components/sf/screens/Signer';
import { serverCaller } from '@/lib/api/client';
import { documents as documentsApi, fields as fieldsApi, recipients as recipientsApi } from '@/lib/api/resources';
import { toSignerFields, toSignerRecipients, toSignValues } from '@/lib/sf/adapters';
import type { DocumentResponse, FieldResponse, RecipientResponse } from '@/lib/api/types';

export const metadata: Metadata = { title: 'Signer view · SignForge' };

type SearchParams = { document?: string; recipient?: string };

export default async function Page({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const api = serverCaller('/documents/signer-view');
  const params = (await searchParams) ?? {};

  let document: DocumentResponse | null = null;
  if (params.document) {
    const result = await documentsApi.get(api, params.document);
    if (result.ok) document = result.data;
  }
  if (!document) {
    const newest = await documentsApi.library(api, { sort: 'recent', limit: 1 });
    document = newest.ok ? (newest.data.items[0] ?? null) : null;
  }

  // A tenant with no documents yet: the store's authoring fields keep the
  // designed surface intact instead of rendering blank paper.
  if (!document) return <Signer />;

  const [fieldsResult, recipientsResult] = await Promise.all([
    fieldsApi.list(api, document.id),
    recipientsApi.list(api, document.id),
  ]);

  const apiFields: FieldResponse[] = fieldsResult.ok ? fieldsResult.data : [];
  const apiRecipients: RecipientResponse[] = recipientsResult.ok ? recipientsResult.data : [];
  const recipientList = toSignerRecipients(apiRecipients);

  // Preview the first signer in the routing order (or an explicit ?recipient=).
  const previewed = params.recipient
    ? recipientList.find(r => r.id === params.recipient)
    : (recipientList.find(r => r.role === 'sign') ?? recipientList[0]);

  const assigned = toSignerFields(apiFields).filter(f => !previewed || f.to === previewed.id);
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
