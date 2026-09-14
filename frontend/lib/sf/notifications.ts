/**
 * Where a notification leads.
 *
 * One rule, shared by the header bell and the notifications page: the two must
 * not disagree about what clicking a row does. Rows carry their destination in
 * `screen`, so neither surface has to guess from the title — an envelope event
 * points at that envelope's trail, a billing or support event at its own
 * screen. A row whose `screen` is not a screen this build has still renders; it
 * just does not navigate, which is better than routing to a 404.
 */
import type { NotificationRow } from '@/lib/api/types';
import { SCREEN_PATH, documentPathFor, isDocumentScreen, type ScreenKey } from '@/lib/sf/routes';

/** How many rows a page of the feed holds. Paging is "show more", not numbered
 *  pages: a feed is read from the top down and nobody navigates to page 4 of it.
 *  Lives here, not in the screen, because the server component that renders the
 *  first page imports it — a value exported from a `'use client'` module reaches
 *  the server as a client-reference stub, not as 50. */
export const PAGE_SIZE = 50;

export function notificationHref(row: NotificationRow): string | null {
  const screen = row.screen as ScreenKey | null;
  if (!screen || !(screen in SCREEN_PATH)) {
    /* No usable screen, but an envelope to show: its trail explains the event
       the row is reporting. */
    return row.target_id ? documentPathFor('audit', row.target_id) : null;
  }
  if (isDocumentScreen(screen)) {
    return row.target_id ? documentPathFor(screen, row.target_id) : null;
  }
  return SCREEN_PATH[screen];
}
