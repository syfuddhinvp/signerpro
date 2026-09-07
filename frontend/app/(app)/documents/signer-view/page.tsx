/**
 * Flat entry point for the sign screen.
 *
 * The screen itself lives at `/documents/[id]/signer-view` — the envelope's identity
 * belongs in the path. This route exists so the sidebar link (and any old
 * bookmark) still works from a cold start: it resolves the most recently touched document and redirects
 * to that document's own URL. With no document at all, it falls through to the
 * library, which is where one gets created.
 */

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { serverCaller } from '@/lib/api/client';
import { documents as documentsApi } from '@/lib/api/resources';
import { documentPathFor, SCREEN_PATH } from '@/lib/sf/routes';

export const metadata: Metadata = { title: 'Signer view · SignerPro' };

type SearchParams = Record<string, string | string[] | undefined>;

export default async function Page({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const query = (await searchParams) ?? {};
  // Old `?document=<id>` links keep working: they redirect into the path form.
  const requested = typeof query.document === 'string' ? query.document : null;
  if (requested) redirect(documentPathFor('sign', requested));

  const api = serverCaller(SCREEN_PATH['sign']);
  const newest = await documentsApi.library(api, { sort: 'recent', limit: 1 });
  const documentId = newest.ok ? (newest.data.items[0]?.id ?? null) : null;
  redirect(documentId ? documentPathFor('sign', documentId) : SCREEN_PATH.dashboard);
}
