/**
 * Flat entry point for the builder screen.
 *
 * The screen itself lives at `/documents/[id]/prepare` — the envelope's identity
 * belongs in the path. This route exists so the sidebar link (and any old
 * bookmark) still works from a cold start: it resolves the newest draft and redirects
 * to that document's own URL. With no document at all, it falls through to the
 * library, which is where one gets created.
 */

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { serverCaller } from '@/lib/api/client';
import { documents as documentsApi } from '@/lib/api/resources';
import { documentPathFor, SCREEN_PATH } from '@/lib/sf/routes';

export const metadata: Metadata = { title: 'Prepare document · SignForge' };

type SearchParams = Record<string, string | string[] | undefined>;

export default async function Page({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const query = (await searchParams) ?? {};
  // Old `?document=<id>` links keep working: they redirect into the path form.
  const requested = typeof query.document === 'string' ? query.document : null;
  if (requested) redirect(documentPathFor('builder', requested));

  const api = serverCaller(SCREEN_PATH['builder']);
  const newest = await documentsApi.library(api, { quick: 'drafts', sort: 'recent', limit: 1 });
  const documentId = newest.ok ? (newest.data.items[0]?.id ?? null) : null;
  redirect(documentId ? documentPathFor('builder', documentId) : SCREEN_PATH.dashboard);
}
