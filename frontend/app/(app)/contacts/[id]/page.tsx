/**
 * One contact's record, keyed off the `[id]` route param.
 *
 * Same three steps as `/contacts` (see `lib/api/README.md`): fetch on the
 * server, adapt with `lib/sf/adapters`, hand the shapes to the client screen.
 */

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import ContactRecord from '@/components/sf/screens/ContactRecord';
import { serverCaller } from '@/lib/api/client';
import { contacts as contactsApi, documents as documentsApi } from '@/lib/api/resources';
import { toContact, toGroupLabels } from '@/lib/sf/adapters';
import { contactPathFor } from '@/lib/sf/routes';
import type { ContactGroupResponse, ContactHistoryEntry, DocumentLibraryPage } from '@/lib/api/types';

export const metadata: Metadata = { title: 'Contact · SignerPro' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const api = serverCaller(contactPathFor(id));

  const [contactResult, historyResult, groupsResult, draftsResult] = await Promise.all([
    contactsApi.get(api, id),
    contactsApi.history(api, id, { limit: 50 }),
    contactsApi.groups(api),
    // "Add as recipient" targets the most recently touched draft, as on the list.
    documentsApi.library(api, { quick: 'drafts', limit: 1 }),
  ]);

  /* A contact of another tenant is a 404 from the API and a 404 here — the
     record is the only thing this route is about, so there is nothing to
     degrade to the way the list can degrade to an empty address book. */
  if (!contactResult.ok) notFound();

  const history: ContactHistoryEntry[] = historyResult.ok ? historyResult.data : [];
  const groups: ContactGroupResponse[] = groupsResult.ok ? groupsResult.data : [];
  const drafts: DocumentLibraryPage | null = draftsResult.ok ? draftsResult.data : null;

  return (
    <ContactRecord
      contact={toContact(contactResult.data)}
      history={history}
      historyFailed={!historyResult.ok}
      groupLabels={toGroupLabels(groups)}
      draftDocumentId={drafts?.items[0]?.id ?? null}
    />
  );
}
