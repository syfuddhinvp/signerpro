/**
 * The queue-shaping the support screen does over the page it holds.
 *
 * These are the orderings triage actually relies on, so they are pinned:
 * a resolved ticket is not "at risk" however long it sat, a breached one
 * outranks one merely due, and a row with no due date does not float to the
 * top of an SLA sort by virtue of having no clock.
 */
import { describe, it, expect } from 'vitest';
import { NO_NARROWING, narrowTickets, queueFacets, sortTickets } from './supportQueue';
import type { TicketResponse } from '@/lib/api/types';

const t = (over: Partial<TicketResponse> & { id: string }): TicketResponse => ({
  organization_id: 'org', organization_name: 'Acme', organization_slug: 'acme',
  reference: 'SF-' + over.id, subject: 'Subject ' + over.id, category: 'General',
  status: 'open', priority: 'normal', assignee_user_id: null, assignee_name: null,
  document_id: null, document_title: null, tags: [],
  sla_due_at: null, sla_label: '—', sla_breached: false,
  requester_name: 'Ada', requester_email: 'ada@example.com',
  created_at: '2026-09-01T10:00:00Z', updated_at: '2026-09-01T10:00:00Z',
  resolved_at: null, message_count: 1,
  ...over,
});

const ids = (rows: TicketResponse[]) => rows.map(r => r.id);

describe('sortTickets', () => {
  it('puts breached live tickets first and resolved ones last under SLA risk', () => {
    const rows = [
      t({ id: 'calm', sla_due_at: '2026-09-09T10:00:00Z' }),
      t({ id: 'closed', status: 'resolved', sla_breached: true }),
      t({ id: 'late', sla_breached: true, sla_due_at: '2026-09-02T10:00:00Z' }),
      t({ id: 'soon', sla_due_at: '2026-09-08T10:00:00Z' }),
    ];
    expect(ids(sortTickets(rows, 'sla'))).toEqual(['late', 'soon', 'calm', 'closed']);
  });

  it('does not float a ticket with no due date above one that is actually due', () => {
    const rows = [t({ id: 'nodue' }), t({ id: 'due', sla_due_at: '2026-09-30T10:00:00Z' })];
    expect(ids(sortTickets(rows, 'sla'))).toEqual(['due', 'nodue']);
  });

  it('orders by priority, oldest first inside a band', () => {
    const rows = [
      t({ id: 'low', priority: 'low' }),
      t({ id: 'p1-new', priority: 'urgent', created_at: '2026-09-05T10:00:00Z' }),
      t({ id: 'p1-old', priority: 'urgent', created_at: '2026-09-02T10:00:00Z' }),
      t({ id: 'high', priority: 'high' }),
    ];
    expect(ids(sortTickets(rows, 'priority'))).toEqual(['p1-old', 'p1-new', 'high', 'low']);
  });

  it('sorts an unknown priority with P3 rather than at the top', () => {
    const rows = [t({ id: 'weird', priority: 'whatever' }), t({ id: 'p1', priority: 'urgent' })];
    expect(ids(sortTickets(rows, 'priority'))).toEqual(['p1', 'weird']);
  });

  it('orders by creation and by last activity', () => {
    const rows = [
      t({ id: 'a', created_at: '2026-09-01T10:00:00Z', updated_at: '2026-09-07T10:00:00Z' }),
      t({ id: 'b', created_at: '2026-09-05T10:00:00Z', updated_at: '2026-09-05T10:00:00Z' }),
    ];
    expect(ids(sortTickets(rows, 'newest'))).toEqual(['b', 'a']);
    expect(ids(sortTickets(rows, 'oldest'))).toEqual(['a', 'b']);
    expect(ids(sortTickets(rows, 'updated'))).toEqual(['a', 'b']);
  });

  it('leaves the caller array alone', () => {
    const rows = [t({ id: 'b', priority: 'low' }), t({ id: 'a', priority: 'urgent' })];
    sortTickets(rows, 'priority');
    expect(ids(rows)).toEqual(['b', 'a']);
  });
});

describe('narrowTickets', () => {
  const rows = [
    t({ id: 'breached', sla_breached: true, assignee_user_id: 'u1' }),
    t({ id: 'mine', assignee_user_id: 'u1' }),
    t({ id: 'orphan' }),
    t({ id: 'both', sla_breached: true }),
  ];

  it('is a no-op with nothing selected', () => {
    expect(ids(narrowTickets(rows, NO_NARROWING))).toEqual(['breached', 'mine', 'orphan', 'both']);
  });

  it('narrows to breached, to unassigned, and to the intersection', () => {
    expect(ids(narrowTickets(rows, { breached: true, unassigned: false }))).toEqual(['breached', 'both']);
    expect(ids(narrowTickets(rows, { breached: false, unassigned: true }))).toEqual(['orphan', 'both']);
    expect(ids(narrowTickets(rows, { breached: true, unassigned: true }))).toEqual(['both']);
  });
});

describe('queueFacets', () => {
  it('counts breached, unassigned, and live P1s', () => {
    expect(queueFacets([
      t({ id: '1', sla_breached: true, priority: 'urgent' }),
      t({ id: '2', assignee_user_id: 'u1' }),
      // A resolved P1 is not an open fire, and must not be counted as one.
      t({ id: '3', priority: 'urgent', status: 'resolved', assignee_user_id: 'u1' }),
    ])).toEqual({ breached: 1, unassigned: 1, urgent: 1 });
  });

  it('counts an empty page as zero of everything', () => {
    expect(queueFacets([])).toEqual({ breached: 0, unassigned: 0, urgent: 0 });
  });
});
