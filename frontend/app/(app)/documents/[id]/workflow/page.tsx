/**
 * Signing workflow / routing for one envelope, keyed off the `[id]` route
 * param. `/documents/workflow` resolves the newest draft and redirects here.
 */

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Routing from '@/components/sf/screens/Routing';
import { serverCaller } from '@/lib/api/client';
import { documents as documentsApi, recipients as recipientsApi } from '@/lib/api/resources';
import { toBuilderRouting } from '@/lib/sf/adapters';
import { documentPathFor } from '@/lib/sf/routes';
import type { RecipientResponse, RoutingResponse } from '@/lib/api/types';

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

  const recipients: RecipientResponse[] = recipientsResult.ok ? recipientsResult.data : [];
  const routing: RoutingResponse | null = routingResult.ok ? routingResult.data : null;

  return (
    <Routing
      documentId={documentResult.data.id}
      recipients={recipients}
      routing={routing ? toBuilderRouting(routing) : null}
    />
  );
}
