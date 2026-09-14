/**
 * Signing workflow / routing for one envelope, keyed off the `[id]` route
 * param. `/documents/workflow` resolves the newest draft and redirects here.
 */

import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import Routing from '@/components/sf/screens/Routing';
import { serverCaller } from '@/lib/api/client';
import { brandingThemes as brandingApi, documents as documentsApi, recipients as recipientsApi } from '@/lib/api/resources';
import { toBuilderRouting } from '@/lib/sf/adapters';
import { documentPathFor } from '@/lib/sf/routes';
import { isSealedStatus } from '@/lib/sf/sealed';
import type { BrandingThemeResponse, RecipientResponse, RoutingResponse } from '@/lib/api/types';
import ApiUnavailable from '@/components/sf/ApiUnavailable';

export const metadata: Metadata = { title: 'Signing workflow · SignerPro' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id: documentId } = await params;
  const api = serverCaller(documentPathFor('routing', documentId));

  const [documentResult, recipientsResult, routingResult, themesResult] = await Promise.all([
    documentsApi.get(api, documentId),
    recipientsApi.list(api, documentId),
    documentsApi.routing(api, documentId),
    /* The theme picker needs the tenant's list. A tenant with no themes gets
       an empty array and the picker says so rather than disappearing. */
    brandingApi.list(api),
  ]);

  if (!documentResult.ok) notFound();

  /* A completed (or voided / declined / expired) envelope is evidence, not a
     draft: the API locks its fields and refuses further authoring, so the
     screen redirects to the one place that still has something to say. */
  if (isSealedStatus(documentResult.data.status)) redirect(documentPathFor('audit', documentId));


  const recipients: RecipientResponse[] = recipientsResult.ok ? recipientsResult.data : [];
  const routing: RoutingResponse | null = routingResult.ok ? routingResult.data : null;
  const themes: BrandingThemeResponse[] = themesResult.ok ? themesResult.data : [];

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
        brandingThemes={themes}
      />
    </>
  );
}
