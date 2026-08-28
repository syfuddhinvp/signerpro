/**
 * Signing workflow / routing.
 *
 * Same structural caveat as the prepare screen: routing belongs to one
 * document, so `/documents/[id]/workflow` would be the better route. Until
 * `lib/sf/routes.ts` carries a parameterised entry the document comes from
 * `?document=<id>`, falling back to the newest draft, and the link between the
 * two screens preserves the param.
 */

import type { Metadata } from 'next';
import Routing from '@/components/sf/screens/Routing';
import { serverCaller } from '@/lib/api/client';
import { documents as documentsApi, recipients as recipientsApi } from '@/lib/api/resources';
import { toBuilderRouting } from '@/lib/sf/adapters';
import type { RecipientResponse, RoutingResponse } from '@/lib/api/types';

export const metadata: Metadata = { title: 'Signing workflow · SignForge' };

type SearchParams = { [key: string]: string | string[] | undefined };

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const api = serverCaller('/documents/workflow');
  const params = await searchParams;
  const requested = typeof params.document === 'string' ? params.document : null;

  let documentId = requested;
  if (!documentId) {
    const drafts = await documentsApi.library(api, { quick: 'drafts', sort: 'recent', limit: 1 });
    documentId = drafts.ok ? (drafts.data.items[0]?.id ?? null) : null;
  }

  if (!documentId) {
    return <Routing documentId={null} recipients={[]} routing={null} />;
  }

  const [documentResult, recipientsResult, routingResult] = await Promise.all([
    documentsApi.get(api, documentId),
    recipientsApi.list(api, documentId),
    documentsApi.routing(api, documentId),
  ]);

  if (!documentResult.ok) {
    return <Routing documentId={null} recipients={[]} routing={null} />;
  }

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
