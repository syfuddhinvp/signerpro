/**
 * Queue-shaping for the support screen.
 *
 * The API owns the *selection* of tickets (status, priority, assignee, search
 * — see `support.ticketPage`), so nothing here re-filters what the server was
 * asked for. What is left is the ordering and the two narrowings that have no
 * server parameter: "breached only" and "unassigned only". Both read fields
 * the rows already carry, so they cost a pass over the page rather than a
 * round trip.
 *
 * These run on raw `TicketResponse` rows, before the adapter formats their
 * timestamps — `created_at` sorts, "28 Aug 11:45" does not.
 */

import type { TicketResponse } from '@/lib/api/types';

export type QueueSort = 'sla' | 'updated' | 'newest' | 'oldest' | 'priority';

export const QUEUE_SORTS: [QueueSort, string][] = [
  ['sla', 'SLA risk'],
  ['updated', 'Recently updated'],
  ['newest', 'Newest first'],
  ['oldest', 'Oldest first'],
  ['priority', 'Priority'],
];

/** P1 sorts above P4; an unknown priority sorts with P3 rather than first. */
const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

const rank = (priority: string): number =>
  PRIORITY_RANK[priority] === undefined ? PRIORITY_RANK.normal : PRIORITY_RANK[priority];

/* A resolved ticket is never "at risk", however long it sat before it closed,
   so SLA order pushes the closed ones under the live queue. */
const isLive = (t: TicketResponse): boolean => t.status !== 'resolved';

const time = (iso: string | null): number => (iso ? Date.parse(iso) || 0 : 0);

export function sortTickets(items: TicketResponse[], sort: QueueSort): TicketResponse[] {
  const rows = items.slice();
  switch (sort) {
    case 'newest':
      return rows.sort((a, b) => time(b.created_at) - time(a.created_at));
    case 'oldest':
      return rows.sort((a, b) => time(a.created_at) - time(b.created_at));
    case 'updated':
      return rows.sort((a, b) => time(b.updated_at) - time(a.updated_at));
    case 'priority':
      return rows.sort((a, b) => rank(a.priority) - rank(b.priority) || time(a.created_at) - time(b.created_at));
    case 'sla':
    default:
      /* Live before resolved, breached before merely due, then by how soon the
         clock runs out, then by priority for rows with no due date at all. */
      return rows.sort((a, b) =>
        Number(isLive(b)) - Number(isLive(a))
        || Number(b.sla_breached) - Number(a.sla_breached)
        || (time(a.sla_due_at) || Infinity) - (time(b.sla_due_at) || Infinity)
        || rank(a.priority) - rank(b.priority));
  }
}

export type QueueNarrowing = { breached: boolean; unassigned: boolean };

export const NO_NARROWING: QueueNarrowing = { breached: false, unassigned: false };

export function narrowTickets(items: TicketResponse[], narrowing: QueueNarrowing): TicketResponse[] {
  return items.filter(t =>
    (!narrowing.breached || t.sla_breached)
    && (!narrowing.unassigned || !t.assignee_user_id));
}

/**
 * The "needs attention" tallies, counted over the page the screen holds. They
 * describe what is on screen, so the chips that show them are labelled with
 * that scope rather than presented as a queue-wide measurement.
 */
export type QueueFacets = { breached: number; unassigned: number; urgent: number };

export function queueFacets(items: TicketResponse[]): QueueFacets {
  let breached = 0, unassigned = 0, urgent = 0;
  for (const t of items) {
    if (t.sla_breached) breached += 1;
    if (!t.assignee_user_id) unassigned += 1;
    if (t.priority === 'urgent' && isLive(t)) urgent += 1;
  }
  return { breached, unassigned, urgent };
}
