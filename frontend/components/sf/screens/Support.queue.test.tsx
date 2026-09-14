/**
 * The support queue's triage controls.
 *
 * The properties worth pinning are the ones that decide whether the queue can
 * be *worked*: a filter with a server parameter re-queries (it never narrows a
 * client array behind the reader's back), the two narrowings that have no
 * parameter are honest about being a pass over the page in hand, keyboard
 * walking opens what it lands on, a reply survives a click on another ticket,
 * and no write can be fired twice while the first is still in flight.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithSF, resetNavigation, setPathname } from '@/test/utils';
import type { SupportAgent, TicketDetailResponse, TicketPage, TicketResponse } from '@/lib/api/types';
import Support from './Support';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).navigationMock());

const apiCall = vi.fn();
vi.mock('@/lib/api/browser', () => ({ apiCall: (...args: unknown[]) => apiCall(...args) }));

const ticket = (over: Partial<TicketResponse> & { id: string }): TicketResponse => ({
  organization_id: 'org', organization_name: 'Acme Corporation', organization_slug: 'acme',
  reference: 'SF-' + over.id, subject: 'Subject ' + over.id, category: 'General',
  status: 'open', priority: 'normal', assignee_user_id: null, assignee_name: null,
  document_id: null, document_title: null, tags: [],
  sla_due_at: '2026-09-20T10:00:00Z', sla_label: '4h 0m left', sla_breached: false,
  requester_name: 'Ada Lovelace', requester_email: 'ada@example.com',
  created_at: '2026-09-01T10:00:00Z', updated_at: '2026-09-02T10:00:00Z',
  resolved_at: null, message_count: 2,
  ...over,
});

const detailOf = (row: TicketResponse): TicketDetailResponse => ({
  ...row,
  messages: [
    { id: 'm1', author_name: 'Ada Lovelace', is_staff: false, is_internal: false, body: 'It is broken', created_at: '2026-09-01T10:00:00Z' },
    { id: 'm2', author_name: 'Dana Ops', is_staff: true, is_internal: true, body: 'Rotating the key', created_at: '2026-09-02T10:00:00Z' },
  ] as TicketDetailResponse['messages'],
});

const rows = [
  ticket({ id: 'calm', subject: 'Late fee dispute', assignee_user_id: 'u1', assignee_name: 'Dana Ops' }),
  ticket({ id: 'late', subject: 'Signer cannot open link', sla_breached: true, priority: 'urgent', sla_due_at: '2026-09-02T10:00:00Z' }),
];

const page = (over: Partial<TicketPage> = {}): TicketPage => ({
  items: rows, total: 7,
  counts: { all: 7, open: 3, pending: 1, escalated: 0, resolved: 3 },
  ...over,
});

const agents: SupportAgent[] = [
  { id: 'u1', name: 'Dana Ops', email: 'dana@signerpro.test', specialty: 'Billing', open_ticket_count: 4 },
];

const ok = <T,>(data: T) => ({ ok: true as const, data });

/** The last ticket-page GET the screen made, as `[path, init]`. */
const lastList = () => apiCall.mock.calls.filter(c => c[0] === '/api/support/tickets/page').at(-1);
const queryOf = () => (lastList()?.[1] as { query?: Record<string, unknown> } | undefined)?.query ?? {};
/** Open the thread drawer on a row, by its subject. The thread is no longer
 *  mounted with the screen: it is a dialog, opened by clicking a row. */
const openThread = (subject: string) => fireEvent.click(queue().getByText(subject));
/** The queue rows, in the order they are rendered. The ticket subject also
 *  appears in the detail header, so queue assertions stay inside this group.
 *  Each row carries a checkbox and an actions menu besides the button that
 *  opens it, so rows are found by `data-ticket-row` rather than by role. */
const queue = () => within(screen.getByRole('group', { name: 'Ticket queue' }));
const queueRows = () =>
  Array.from(screen.getByRole('group', { name: 'Ticket queue' }).querySelectorAll('[data-ticket-row]'));

function renderQueue(props: Partial<React.ComponentProps<typeof Support>> = {}) {
  return renderWithSF(
    <Support
      page={props.page ?? page()}
      detail={props.detail ?? detailOf(rows[0])}
      agents={props.agents ?? agents}
      stats={props.stats ?? []}
      quickReplies={props.quickReplies ?? [['Ask for logs', 'Could you send the request id?']]}
      scope={props.scope ?? 'all'}
    />,
  );
}

beforeEach(() => {
  cleanup();
  resetNavigation();
  setPathname('/platform/support');
  apiCall.mockReset();
  apiCall.mockImplementation((path: string) => {
    if (path === '/api/support/tickets/page') return Promise.resolve(ok(page()));
    return Promise.resolve(ok(detailOf(rows[0])));
  });
});

describe('the support queue controls', () => {
  it('sends priority and assignee to the API rather than filtering on screen', async () => {
    renderQueue();

    fireEvent.change(screen.getByLabelText('Filter by priority'), { target: { value: 'urgent' } });
    await waitFor(() => expect(queryOf()).toMatchObject({ priority: 'urgent' }));

    fireEvent.change(screen.getByLabelText('Filter by assignee'), { target: { value: 'u1' } });
    await waitFor(() => expect(queryOf()).toMatchObject({ priority: 'urgent', assignee_user_id: 'u1' }));
  });

  it('shows each agent load in the assignee filter', () => {
    renderQueue();
    expect(within(screen.getByLabelText('Filter by assignee')).getByRole('option', { name: 'Dana Ops · 4 open' })).toBeInTheDocument();
  });

  it('narrows to breached rows without a round trip, and says what it is showing', async () => {
    renderQueue();
    expect(screen.getByText('Showing 1–2 of 7 · ↑↓ to walk the queue')).toBeInTheDocument();

    const chips = within(screen.getByRole('group', { name: 'Needs attention' }));
    fireEvent.click(chips.getByRole('button', { name: /^Breached/ }));

    expect(queue().queryByText('Late fee dispute')).toBeNull();
    expect(queue().getByText('Signer cannot open link')).toBeInTheDocument();
    expect(screen.getByText('Showing 1–1 of 7 · ↑↓ to walk the queue')).toBeInTheDocument();
    // "Unassigned" has no server parameter either — neither chip re-queries.
    expect(apiCall.mock.calls.filter(c => c[0] === '/api/support/tickets/page')).toHaveLength(0);
  });

  it('sorts the page it holds — SLA risk first, and newest on request', () => {
    renderQueue();
    expect(queueRows()[0]).toHaveTextContent('Signer cannot open link');

    fireEvent.change(screen.getByLabelText('Sort tickets'), { target: { value: 'oldest' } });
    // Same creation time on both rows, so oldest-first falls back to page order.
    expect(queueRows()[0]).toHaveTextContent('Late fee dispute');
    expect(queueRows()[1]).toHaveTextContent('Signer cannot open link');
  });

  it('offers a way out of a filter that matches nothing', async () => {
    renderQueue();
    fireEvent.change(screen.getByLabelText('Search tickets'), { target: { value: 'nothing matches' } });
    apiCall.mockImplementation((path: string) =>
      Promise.resolve(ok(path === '/api/support/tickets/page' ? page({ items: [] }) : detailOf(rows[0]))));
    await waitFor(() => expect(screen.getByText(/No tickets match these filters/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect((screen.getByLabelText('Search tickets') as HTMLInputElement).value).toBe('');
    await waitFor(() => expect(queryOf().q).toBeUndefined());
  });

  it('marks the open ticket and walks the queue with the arrow keys', async () => {
    renderQueue();
    // SLA order puts the breached row first; the opened ticket is the other one.
    expect(queueRows()[0]).not.toHaveAttribute('aria-current');
    expect(queueRows()[1]).toHaveAttribute('aria-current', 'true');

    apiCall.mockImplementation((path: string) =>
      Promise.resolve(ok(path === '/api/support/tickets/page' ? page() : detailOf(rows[1]))));
    fireEvent.keyDown(queueRows()[1], { key: 'ArrowUp' });
    await waitFor(() => expect(queueRows()[0]).toHaveAttribute('aria-current', 'true'));
    expect(apiCall).toHaveBeenCalledWith('/api/support/tickets/late', expect.anything());
    expect(queueRows()[0]).toHaveFocus();
  });

  it('shows who owns a ticket and when it last moved on the row itself', () => {
    renderQueue();
    expect(queue().getByText(/^Dana Ops · updated .* · 2 messages$/)).toBeInTheDocument();
    expect(queue().getByText(/^Unassigned · updated /)).toBeInTheDocument();
  });
});

describe('the ticket thread', () => {
  it('hides internal notes on request without hiding that they exist', () => {
    renderQueue();
    openThread('Late fee dispute');
    expect(screen.getByText('Rotating the key')).toBeInTheDocument();
    expect(screen.getByText('2 messages · 1 internal')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'View as the customer' }));
    expect(screen.queryByText('Rotating the key')).toBeNull();
    expect(screen.getByText('1 message · 1 internal')).toBeInTheDocument();
  });

  it('keeps a per-ticket draft when the reader clicks another ticket', async () => {
    renderQueue();
    openThread('Late fee dispute');
    const reply = screen.getByLabelText('Reply');
    fireEvent.change(reply, { target: { value: 'half-written answer' } });

    apiCall.mockImplementation((path: string) =>
      Promise.resolve(ok(path === '/api/support/tickets/page' ? page() : detailOf(rows[1]))));
    fireEvent.click(queue().getByText('Signer cannot open link'));
    await waitFor(() => expect((screen.getByLabelText('Reply') as HTMLTextAreaElement).value).toBe(''));

    apiCall.mockImplementation((path: string) =>
      Promise.resolve(ok(path === '/api/support/tickets/page' ? page() : detailOf(rows[0]))));
    fireEvent.click(queue().getByText('Late fee dispute'));
    await waitFor(() => expect((screen.getByLabelText('Reply') as HTMLTextAreaElement).value).toBe('half-written answer'));
  });

  it('sends on ⌘↵ and refuses a second write while the first is in flight', async () => {
    renderQueue();
    openThread('Late fee dispute');
    fireEvent.change(screen.getByLabelText('Reply'), { target: { value: 'here is the fix' } });

    let release: (v: unknown) => void = () => {};
    apiCall.mockImplementation((path: string) => {
      if (path.endsWith('/reply')) return new Promise(res => { release = res; });
      return Promise.resolve(ok(path === '/api/support/tickets/page' ? page() : detailOf(rows[0])));
    });

    fireEvent.keyDown(screen.getByLabelText('Reply'), { key: 'Enter', metaKey: true });
    await waitFor(() => expect(apiCall).toHaveBeenCalledWith(expect.stringContaining('/reply'), expect.anything()));

    // While the reply is unanswered every write control is disabled.
    expect(screen.getByRole('button', { name: 'Mark resolved' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Escalate' })).toBeDisabled();
    expect(screen.getByText('Saving…')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));
    expect(apiCall.mock.calls.filter(c => String(c[0]).endsWith('/reply'))).toHaveLength(1);

    release(ok(detailOf(rows[0])));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mark resolved' })).toBeEnabled());
  });
});

/**
 * The table the queue is drawn as: server-side paging, bulk selection, and an
 * export of exactly what is on screen. Each of these can quietly act on the
 * wrong rows -- a stale offset, a selection that survives a filter, an export
 * of unfiltered data -- so each is pinned to the rows actually shown.
 */
describe('the queue table', () => {
  beforeEach(() => {
    cleanup();
    resetNavigation();
    setPathname('/platform/support');
    apiCall.mockReset();
    apiCall.mockImplementation((path: string) =>
      Promise.resolve(ok(path === '/api/support/tickets/page' ? page() : detailOf(rows[0]))));
  });

  it('pages with an offset and says which rows it is showing', async () => {
    // 60 tickets at 25 a page: three pages, so the pager has somewhere to go.
    renderQueue({ page: page({ total: 60 }) });
    expect(screen.getByText('Showing 1–2 of 60 · ↑↓ to walk the queue')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }));
    await waitFor(() => expect(queryOf().offset).toBe(25));
    expect(queryOf().limit).toBe(25);
  });

  it('goes back to the first page when a filter narrows the results', async () => {
    renderQueue({ page: page({ total: 60 }) });
    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }));
    await waitFor(() => expect(queryOf().offset).toBe(25));

    fireEvent.change(screen.getByLabelText('Filter by priority'), { target: { value: 'urgent' } });
    // An offset kept across a narrowing can land past the end of the results,
    // which reads as an empty queue rather than a filtered one.
    await waitFor(() => expect(queryOf().offset).toBe(0));
    expect(queryOf().priority).toBe('urgent');
  });

  it('resolves a selection with one write per ticket, then refetches once', async () => {
    renderQueue();
    fireEvent.click(screen.getByLabelText('Select every ticket on this page'));
    expect(screen.getByText('2 tickets selected')).toBeInTheDocument();

    apiCall.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Resolve selected' }));
    await waitFor(() => expect(screen.queryByText('2 tickets selected')).toBeNull());

    const patched = apiCall.mock.calls.filter(c => (c[1] as { method?: string })?.method === 'PATCH');
    expect(patched).toHaveLength(2);
    expect(patched.map(c => c[0]).sort()).toEqual(['/api/support/tickets/calm', '/api/support/tickets/late']);
    expect(apiCall.mock.calls.filter(c => c[0] === '/api/support/tickets/page')).toHaveLength(1);
  });

  it('drops a selected row that a narrowing has hidden', () => {
    renderQueue();
    fireEvent.click(screen.getByLabelText('Select SF-calm'));
    expect(screen.getByText('1 ticket selected')).toBeInTheDocument();

    // SF-calm is not breached, so this narrowing hides it. A bulk action must
    // not still be holding a row the reader can no longer see.
    fireEvent.click(within(screen.getByRole('group', { name: 'Needs attention' })).getByRole('button', { name: /^Breached/ }));
    expect(screen.queryByText('1 ticket selected')).toBeNull();
  });

  it('exports the rows on screen, not the whole queue', () => {
    const created: string[] = [];
    const createUrl = vi.fn((blob: Blob) => { void blob; return 'blob:csv'; });
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = createUrl as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL;
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      created.push(this.download);
    });
    try {
      renderQueue();
      fireEvent.click(within(screen.getByRole('group', { name: 'Needs attention' })).getByRole('button', { name: /^Breached/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

      expect(created).toEqual(['support-tickets.csv']);
      const blob = createUrl.mock.calls[0][0] as Blob;
      expect(blob.type).toContain('text/csv');
      return blob.text().then(text => {
        const lines = text.trim().split('\n');
        // Header plus the one breached row -- the filtered-out row is absent.
        expect(lines).toHaveLength(2);
        expect(lines[1]).toContain('Signer cannot open link');
        expect(text).not.toContain('Late fee dispute');
      });
    } finally {
      click.mockRestore();
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
    }
  });
});

/**
 * The thread drawer. It is a *non-modal* panel on purpose: the queue behind it
 * has to stay workable, because walking rows with the drawer open is how a
 * queue gets triaged. A modal would make that impossible, so the properties
 * pinned here are the ones a modal would break.
 */
describe('the thread drawer', () => {
  it('opens on the row it was asked for, and closes on Escape', async () => {
    renderQueue();
    expect(screen.queryByLabelText('Reply')).toBeNull();

    openThread('Late fee dispute');
    const panel = await screen.findByRole('region', { name: /^Ticket SF-calm/ });
    expect(within(panel).getByLabelText('Reply')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: /^Ticket SF-calm/ })).toBeNull();
  });

  it('closes on the close button', () => {
    renderQueue();
    openThread('Late fee dispute');
    fireEvent.click(screen.getByRole('button', { name: 'Close ticket' }));
    expect(screen.queryByLabelText('Reply')).toBeNull();
  });

  it('leaves the queue behind it live, so rows can still be walked', async () => {
    renderQueue();
    apiCall.mockImplementation((path: string) =>
      Promise.resolve(ok(path === '/api/support/tickets/page' ? page() : detailOf(rows[1]))));
    openThread('Signer cannot open link');
    await screen.findByRole('region', { name: /^Ticket SF-late/ });

    // The queue is still queryable (a modal would have hidden it from the
    // accessibility tree) and still answers the arrow keys.
    apiCall.mockImplementation((path: string) =>
      Promise.resolve(ok(path === '/api/support/tickets/page' ? page() : detailOf(rows[0]))));
    fireEvent.keyDown(queueRows()[0], { key: 'ArrowDown' });
    await waitFor(() => expect(apiCall).toHaveBeenCalledWith('/api/support/tickets/calm', expect.anything()));
    expect(screen.getByRole('region', { name: /^Ticket SF-calm/ })).toBeInTheDocument();
  });
});
