/**
 * The notifications page — the full record behind the header bell.
 *
 * Server-rendered with the default filter so the first paint is real rows
 * rather than a spinner; every filter change after that re-queries from the
 * client. A failed load is passed through rather than substituted with an
 * empty feed, because "nothing has happened" and "we could not ask" are very
 * different things to a user waiting on a signature.
 */
import type { Metadata } from 'next';
import Notifications from '@/components/sf/screens/Notifications';
import { serverCaller } from '@/lib/api/client';
import { notifications as notificationsApi } from '@/lib/api/resources';
import type { NotificationFeed } from '@/lib/api/types';
import { PAGE_SIZE } from '@/lib/sf/notifications';

export const metadata: Metadata = { title: 'Notifications · SignerPro' };

const EMPTY_FEED: NotificationFeed = {
  items: [], unread: 0, total: 0,
  facets: { tones: { bad: 0, warn: 0, good: 0, info: 0 }, unread: 0, read: 0 },
};

export default async function Page() {
  const api = serverCaller('/notifications');
  const result = await notificationsApi.list(api, { limit: PAGE_SIZE });

  return (
    <Notifications
      feed={result.ok ? result.data : EMPTY_FEED}
      loadError={result.ok ? null : result.error.message}
    />
  );
}
