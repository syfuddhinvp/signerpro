/**
 * Signing workflow / routing for one envelope, keyed off the `[id]` route
 * param. `/documents/workflow` resolves the newest draft and redirects here.
 */

import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import Routing from '@/components/sf/screens/Routing';
import { serverCaller } from '@/lib/api/client';
import { documents as documentsApi, recipients as recipientsApi } from '@/lib/api/resources';
import { toBuilderRouting } from '@/lib/sf/adapters';
import { documentPathFor } from '@/lib/sf/routes';
import { isSealedStatus } from '@/lib/sf/sealed';
import type { RecipientResponse, RoutingResponse } from '@/lib/api/types';
import ApiUnavailable from '@/components/sf/ApiUnavailable';

export const metadata: Metadata = { title: 'Signing workflow · SignForge' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id: documentId } = await params;
  const api = serverCaller(documentPathFor('routing', documentId));

  const [documentResult, recipientsResult, routingResult] = await Promise.all([
    documentsApi.get(api, documentId),
    recipientsApi.list(api, documentId),
    documentsApi.routing(api, documentId),
  ]);

  if (!documentResult.ok) notFound();

  /* A completed (or voided / declined / expired) envelope is evidence, not a
     draft: the API locks its fields and refuses further authoring, so the
     screen redirects to the one place that still has something to say. */
  if (isSealedStatus(documentResult.data.status)) redirect(documentPathFor('audit', documentId));


  const recipients: RecipientResponse[] = recipientsResult.ok ? recipientsResult.data : [];
  const routing: RoutingResponse | null = routingResult.ok ? routingResult.data : null;

  return (
    <>
      {!recipientsResult.ok || !routingResult.ok ? (
        <div style={{ padding: '22px 22px 0' }}>
          <ApiUnavailable what="The routing for this document" detail={(recipientsResult.ok ? null : recipientsResult.error.message) ?? (routingResult.ok ? null : routingResult.error.message)} />
        </div>
      ) : null}
      <Routing
        documentId={documentResult.data.id}
        title={documentResult.data.title}
        recipients={recipients}
        routing={routing ? toBuilderRouting(routing) : null}
      />
    </>
  );
}
