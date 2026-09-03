/**
 * Flat entry point for the builder screen — the *blank* one.
 *
 * The screen itself lives at `/documents/[id]/prepare`: the envelope's identity
 * belongs in the path. This route used to resolve the newest draft and redirect
 * into it, which meant "New envelope" and "Open builder" reopened the document
 * the user prepared last. It now renders the step that actually starts an
 * envelope — pick a PDF — and offers the newest draft as a link rather than
 * forcing it.
 */

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import NewEnvelope from '@/components/sf/screens/NewEnvelope';
import { serverCaller } from '@/lib/api/client';
import { documents as documentsApi } from '@/lib/api/resources';
import { documentPathFor, SCREEN_PATH } from '@/lib/sf/routes';

export const metadata: Metadata = { title: 'New envelope · SignForge' };

type SearchParams = Record<string, string | string[] | undefined>;

export default async function Page({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const query = (await searchParams) ?? {};
  // Old `?document=<id>` links keep working: they redirect into the path form.
  const requested = typeof query.document === 'string' ? query.document : null;
  if (requested) redirect(documentPathFor('builder', requested));

  const api = serverCaller(SCREEN_PATH['builder']);
  const newest = await documentsApi.library(api, { quick: 'drafts', sort: 'recent', limit: 1 });
  const draftId = newest.ok ? (newest.data.items[0]?.id ?? null) : null;

  return <NewEnvelope draftId={draftId} />;
}
