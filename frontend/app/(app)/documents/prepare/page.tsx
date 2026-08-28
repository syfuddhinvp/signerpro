/**
 * Prepare / builder — the document whose fields are being authored.
 *
 * STRUCTURE NOTE: this screen is inherently about one document, so the honest
 * route is `/documents/[id]/prepare` — the id belongs in the path, not a query
 * string, so the URL is shareable, the segment can own its own `loading.tsx`
 * and `not-found.tsx`, and the fetch keys off a route param instead of a
 * search param. `lib/sf/routes.ts` (owned elsewhere) maps the design's
 * `builder` screen key to the flat `/documents/prepare`, so until that map
 * gains a parameterised entry the document is resolved from `?document=<id>`,
 * falling back to the most recently touched draft.
 */

import type { Metadata } from 'next';
import Builder from '@/components/sf/screens/Builder';
import { serverCaller } from '@/lib/api/client';
import {
  documents as documentsApi,
  fields as fieldsApi,
  recipients as recipientsApi,
} from '@/lib/api/resources';
import { toBuilderRouting } from '@/lib/sf/adapters';
import type { FieldResponse, RecipientResponse, RoutingResponse } from '@/lib/api/types';

export const metadata: Metadata = { title: 'Prepare document · SignForge' };

type SearchParams = { [key: string]: string | string[] | undefined };

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const api = serverCaller('/documents/prepare');
  const params = await searchParams;
  const requested = typeof params.document === 'string' ? params.document : null;

  let documentId = requested;
  if (!documentId) {
    // No per-document route yet, so the builder opens the newest draft.
    const drafts = await documentsApi.library(api, { quick: 'drafts', sort: 'recent', limit: 1 });
    documentId = drafts.ok ? (drafts.data.items[0]?.id ?? null) : null;
  }

  if (!documentId) {
    return <Builder documentId={null} title="" pageCount={1} fields={[]} recipients={[]} routing={null} />;
  }

  const [documentResult, fieldsResult, recipientsResult, routingResult] = await Promise.all([
    documentsApi.get(api, documentId),
    fieldsApi.list(api, documentId),
    recipientsApi.list(api, documentId),
    documentsApi.routing(api, documentId),
  ]);

  if (!documentResult.ok) {
    // A deleted id, or one belonging to another tenant (the API answers 404).
    return <Builder documentId={null} title="" pageCount={1} fields={[]} recipients={[]} routing={null} />;
  }

  const document = documentResult.data;
  const fields: FieldResponse[] = fieldsResult.ok ? fieldsResult.data : [];
  const recipients: RecipientResponse[] = recipientsResult.ok ? recipientsResult.data : [];
  const routing: RoutingResponse | null = routingResult.ok ? routingResult.data : null;

  return (
    <Builder
      documentId={document.id}
      title={document.title}
      pageCount={Math.max(1, document.page_count || 1)}
      fields={fields}
      recipients={recipients}
      routing={routing ? toBuilderRouting(routing) : null}
    />
  );
}
