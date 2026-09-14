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
import { contacts as contactsApi } from '@/lib/api/resources';
import { toContactCounts, toContacts, toGroupLabels } from '@/lib/sf/adapters';
import type { ContactGroupResponse, ContactListResponse } from '@/lib/api/types';
import ApiUnavailable from '@/components/sf/ApiUnavailable';

export const metadata: Metadata = { title: 'Contacts · SignerPro' };

const EMPTY_LIST: ContactListResponse = { items: [], total: 0, counts: {} };

export default async function Page() {
  const api = serverCaller('/contacts');

  const [listResult, groupsResult] = await Promise.all([
    contactsApi.list(api, { limit: 200 }),
    contactsApi.groups(api),
  ]);

  const list = listResult.ok ? listResult.data : EMPTY_LIST;
  const groups: ContactGroupResponse[] = groupsResult.ok ? groupsResult.data : [];

  const groupLabels = toGroupLabels(groups);
  const counts = toContactCounts(list.counts ?? {}, list.total, Object.keys(groupLabels));

  return (
    <>
      {!listResult.ok || !groupsResult.ok ? (
        <div style={{ padding: '22px 22px 0' }}>
          <ApiUnavailable what="Your contacts" detail={(listResult.ok ? null : listResult.error.message) ?? (groupsResult.ok ? null : groupsResult.error.message)} />
        </div>
      ) : null}
      <Contacts
        contacts={toContacts(list.items)}
        groupLabels={groupLabels}
        counts={counts}
      />
    </>
  );
}
