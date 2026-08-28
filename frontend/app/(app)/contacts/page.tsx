/**
 * Contacts — the reference server-component screen.
 *
 * The pattern every other screen follows (see `lib/api/README.md`):
 *   1. fetch on the server with `apiFetchOrLogin` + `lib/api/resources`
 *   2. map API shapes to prototype shapes with `lib/sf/adapters`
 *   3. pass them as props into the (unchanged-markup) client screen
 */

import type { Metadata } from 'next';
import Contacts from '@/components/sf/screens/Contacts';
import { serverCaller } from '@/lib/api/client';
import { contacts as contactsApi, documents as documentsApi } from '@/lib/api/resources';
import { toContactCounts, toContacts, toGroupLabels } from '@/lib/sf/adapters';
import type { ContactGroupResponse, ContactListResponse, DocumentLibraryPage } from '@/lib/api/types';

export const metadata: Metadata = { title: 'Contacts · SignForge' };

const EMPTY_LIST: ContactListResponse = { items: [], total: 0, counts: {} };

export default async function Page() {
  const api = serverCaller('/contacts');

  const [listResult, groupsResult, draftsResult] = await Promise.all([
    contactsApi.list(api, { limit: 200 }),
    contactsApi.groups(api),
    // The envelope "Add as recipient" targets the most recently touched draft.
    documentsApi.library(api, { quick: 'drafts', limit: 1 }),
  ]);

  const list = listResult.ok ? listResult.data : EMPTY_LIST;
  const groups: ContactGroupResponse[] = groupsResult.ok ? groupsResult.data : [];
  const drafts: DocumentLibraryPage | null = draftsResult.ok ? draftsResult.data : null;

  const groupLabels = toGroupLabels(groups);
  const counts = toContactCounts(list.counts ?? {}, list.total, Object.keys(groupLabels));

  return (
    <Contacts
      contacts={toContacts(list.items)}
      groupLabels={groupLabels}
      counts={counts}
      draftDocumentId={drafts?.items[0]?.id ?? null}
    />
  );
}
