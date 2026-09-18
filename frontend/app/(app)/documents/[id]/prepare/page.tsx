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
import { isLockedStatus } from '@/lib/sf/sealed';
import type { FieldResponse, RecipientResponse, RoutingResponse } from '@/lib/api/types';
import ApiUnavailable from '@/components/sf/ApiUnavailable';

export const metadata: Metadata = { title: 'Prepare document · SignerPro' };

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

  /* An envelope that is out for signature (or completed / voided / declined /
     expired) is evidence, not a draft: the API refuses further authoring past
     draft/prepared, so the screen redirects to the one place that still has
     something to say. */
  if (isLockedStatus(document.status)) redirect(documentPathFor('audit', documentId));

  const fields: FieldResponse[] = fieldsResult.ok ? fieldsResult.data : [];
  const recipients: RecipientResponse[] = recipientsResult.ok ? recipientsResult.data : [];
  const routing: RoutingResponse | null = routingResult.ok ? routingResult.data : null;

  return (
    <>
      {!fieldsResult.ok || !recipientsResult.ok ? (
        <div style={{ padding: '22px 22px 0' }}>
          <ApiUnavailable what="The fields and recipients on this document" detail={(fieldsResult.ok ? null : fieldsResult.error.message) ?? (recipientsResult.ok ? null : recipientsResult.error.message)} />
        </div>
      ) : null}
      <Builder
        documentId={document.id}
        hasFile={Boolean(document.original_file_path)}
        title={document.title}
        pageCount={Math.max(1, document.page_count || 1)}
        fields={fields}
        recipients={recipients}
        routing={routing ? toBuilderRouting(routing) : null}
        /* Only a template carries this: a document made *from* a catalog form
           inherits the slug too, but it is an envelope being sent, not the
           blueprint being authored, so the banner must not offer to overwrite
           the catalog from it. */
        catalogSlug={document.is_template ? document.source_catalog_slug ?? null : null}
        isTemplate={document.is_template}
      />
    </>
  );
}
