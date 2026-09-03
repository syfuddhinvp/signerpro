/**
 * Prepare / builder — the document whose fields are being authored.
 *
 * The id is a route param, not a search param: this screen is inherently about
 * one envelope, so the URL is shareable, the segment owns its own `loading.tsx`
 * and `not-found.tsx`, and a document that has been deleted or belongs to
 * another tenant is a 404 rather than a silently different document.
 * `/documents/prepare` stays as an entry point that resolves the newest draft
 * and redirects here.
 */

import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import Builder from '@/components/sf/screens/Builder';
import { serverCaller } from '@/lib/api/client';
import {
  documents as documentsApi,
  fields as fieldsApi,
  recipients as recipientsApi,
} from '@/lib/api/resources';
import { toBuilderRouting } from '@/lib/sf/adapters';
import { documentPathFor } from '@/lib/sf/routes';
import { isSealedStatus } from '@/lib/sf/sealed';
import type { FieldResponse, RecipientResponse, RoutingResponse } from '@/lib/api/types';

export const metadata: Metadata = { title: 'Prepare document · SignForge' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id: documentId } = await params;
  const api = serverCaller(documentPathFor('builder', documentId));

  const [documentResult, fieldsResult, recipientsResult, routingResult] = await Promise.all([
    documentsApi.get(api, documentId),
    fieldsApi.list(api, documentId),
    recipientsApi.list(api, documentId),
    documentsApi.routing(api, documentId),
  ]);

  // A deleted id, or one belonging to another tenant (the API answers 404).
  if (!documentResult.ok) notFound();

  const document = documentResult.data;

  /* A completed (or voided / declined / expired) envelope is evidence, not a
     draft: the API locks its fields and refuses further authoring, so the
     screen redirects to the one place that still has something to say. */
  if (isSealedStatus(document.status)) redirect(documentPathFor('audit', documentId));

  const fields: FieldResponse[] = fieldsResult.ok ? fieldsResult.data : [];
  const recipients: RecipientResponse[] = recipientsResult.ok ? recipientsResult.data : [];
  const routing: RoutingResponse | null = routingResult.ok ? routingResult.data : null;

  return (
    <Builder
      documentId={document.id}
      hasFile={Boolean(document.original_file_path)}
      title={document.title}
      pageCount={Math.max(1, document.page_count || 1)}
      fields={fields}
      recipients={recipients}
      routing={routing ? toBuilderRouting(routing) : null}
    />
  );
}
