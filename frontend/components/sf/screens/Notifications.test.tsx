/**
 * The notifications page.
 *
 * The properties worth pinning are the ones that keep the page honest about a
 * feed it only ever holds a page of: filter counts come from the server's
 * facets (not from the rows on screen), filtering re-queries rather than
 * narrowing a client array, a failed load is not rendered as a quiet inbox,
 * and "clear" never touches unread rows.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { router, resetNavigation } from '@/test/navigation';
import type { NotificationFeed, NotificationRow } from '@/lib/api/types';
import Notifications from './Notifications';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).navigationMock());

const apiCall = vi.fn();
vi.mock('@/lib/api/browser', () => ({ apiCall: (...args: unknown[]) => apiCall(...args) }));

const row = (over: Partial<NotificationRow> = {}): NotificationRow => ({
  id: 'n1',
  title: 'Recipient signed',
  detail: 'Purchase agreement — buyer@example.com signed.',
  tone: 'good',
  screen: 'audit',
  target_id: 'doc-1',
  read_at: null,
  created_at: '2026-09-06T09:00:00Z',
  ...over,
});

const feed = (over: Partial<NotificationFeed> = {}): NotificationFeed => ({
  items: [row(), row({ id: 'n2', title: 'Document declined', tone: 'bad', read_at: '2026-09-06T09:30:00Z' })],
  unread: 1,
  total: 2,
  facets: { tones: { bad: 1, warn: 0, good: 1, info: 0 }, unread: 1, read: 1 },
  ...over,
});

const ok = <T,>(data: T) => ({ ok: true as const, data });
const fail = (message = 'boom') => ({ ok: false as const, error: { kind: 'server', status: 500, message } });
const write = (over = {}) => ok({ updated: 0, deleted: 0, unread: 0, ...over });

/** Filter chips share their labels with the per-row actions ("Unread"), so
 *  they are always queried inside their own control group. */
const statusChip = (name: RegExp) =>
  within(screen.getByRole('group', { name: 'Read state' })).getByRole('button', { name });
const kindChip = (name: RegExp) =>
  within(screen.getByRole('group', { name: 'Kind' })).getByRole('button', { name });

/** The last GET the screen made, as `[path, init]`. */
const lastList = () => apiCall.mock.calls.filter(call => call[0] === '/api/notifications').at(-1);

beforeEach(() => {
  cleanup();
  resetNavigation();
  apiCall.mockReset();
  apiCall.mockResolvedValue(ok(feed()));
  vi.useRealTimers();
});

describe('the notifications page', () => {
  it('renders the server feed without refetching it', () => {
    render(<Notifications feed={feed()} />);
    expect(screen.getByText('Recipient signed')).toBeInTheDocument();
    expect(screen.getByText('Document declined')).toBeInTheDocument();
    // The server render already answered the default filter.
    expect(apiCall).not.toHaveBeenCalled();
  });

  it('counts its filters from the server facets, not the rows on screen', () => {
    // One row on screen, but the feed holds far more.
    render(<Notifications feed={feed({
      items: [row()],
      total: 90,
      facets: { tones: { bad: 4, warn: 2, good: 80, info: 4 }, unread: 12, read: 78 },
    })} />);

    expect(statusChip(/^Unread\s*12$/)).toBeInTheDocument();
    expect(statusChip(/^Read\s*78$/)).toBeInTheDocument();
    expect(statusChip(/^All\s*90$/)).toBeInTheDocument();
    expect(kindChip(/Completions\s*80/)).toBeInTheDocument();
    expect(screen.getByText('Showing 1 of 90')).toBeInTheDocument();
  });

  it('re-queries the API when a filter changes instead of narrowing the page', async () => {
    render(<Notifications feed={feed()} />);

    fireEvent.click(statusChip(/^Unread/));
    await waitFor(() => expect(lastList()).toBeTruthy());
    expect(lastList()?.[1]).toMatchObject({ query: expect.objectContaining({ status: 'unread' }) });

    fireEvent.click(kindChip(/Problems/));
    await waitFor(() =>
      expect(lastList()?.[1]).toMatchObject({ query: expect.objectContaining({ tone: 'bad', status: 'unread' }) }),
    );
  });

  it('sends the search term and the time window to the API', async () => {
    render(<Notifications feed={feed()} />);

    fireEvent.change(screen.getByLabelText('Search notifications'), { target: { value: 'Mutual NDA' } });
    await waitFor(() =>
      expect(lastList()?.[1]).toMatchObject({ query: expect.objectContaining({ q: 'Mutual NDA' }) }),
    );

    fireEvent.change(screen.getByLabelText('Time window'), { target: { value: '7' } });
    await waitFor(() =>
      expect(lastList()?.[1]).toMatchObject({ query: expect.objectContaining({ since_days: 7 }) }),
    );
  });

  it('asks for a bigger page on "Show more"', async () => {
    render(<Notifications feed={feed({ total: 120 })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    await waitFor(() => expect(lastList()?.[1]).toMatchObject({ query: expect.objectContaining({ limit: 100 }) }));
  });

  it('hides "Show more" once the whole feed is on screen', () => {
    render(<Notifications feed={feed()} />);
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
  });

  it('applies a bulk action to the selected rows only', async () => {
    apiCall.mockImplementation((path: string) =>
      Promise.resolve(path === '/api/notifications' ? ok(feed()) : write({ updated: 1, unread: 0 })),
    );
    render(<Notifications feed={feed()} />);

    fireEvent.click(screen.getByLabelText('Select "Recipient signed"'));
    expect(screen.getByText('1 selected')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Mark read' }));
    await waitFor(() =>
      expect(apiCall).toHaveBeenCalledWith('/api/notifications/bulk',
        expect.objectContaining({ body: { ids: ['n1'], action: 'read' } })),
    );
    // The badge in the header lives in the server tree, so a write refreshes it.
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });

  it('selects and deselects every row on the page', () => {
    render(<Notifications feed={feed()} />);
    fireEvent.click(screen.getByLabelText('Select all on this page'));
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Deselect all'));
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
  });

  it('offers "Mark unread" as the undo for a row already read', async () => {
    apiCall.mockImplementation((path: string) =>
      Promise.resolve(path === '/api/notifications' ? ok(feed()) : write({ updated: 1, unread: 2 })),
    );
    render(<Notifications feed={feed()} />);

    // n2 is read, so its per-row action is the reverse one.
    fireEvent.click(screen.getByRole('button', { name: 'Unread' }));
    await waitFor(() =>
      expect(apiCall).toHaveBeenCalledWith('/api/notifications/n2/unread', expect.anything()),
    );
  });

  it('disables the feed-wide actions that would do nothing', () => {
    render(<Notifications feed={feed({ facets: { tones: { bad: 0, warn: 0, good: 0, info: 0 }, unread: 0, read: 0 } })} />);
    expect(screen.getByRole('button', { name: 'Mark all read' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear read' })).toBeDisabled();
  });

  it('says "clear" keeps unread rows, because it does', () => {
    render(<Notifications feed={feed()} />);
    expect(screen.getByRole('button', { name: 'Clear read' })).toHaveAttribute(
      'title', expect.stringMatching(/unread ones are kept/i),
    );
  });

  it('opens a row at the envelope it is about, reading it on the way', async () => {
    apiCall.mockImplementation((path: string) =>
      Promise.resolve(path === '/api/notifications' ? ok(feed()) : write({ updated: 1, unread: 0 })),
    );
    render(<Notifications feed={feed()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Recipient signed' }));
    expect(router.push).toHaveBeenCalledWith(expect.stringContaining('doc-1'));
    await waitFor(() =>
      expect(apiCall).toHaveBeenCalledWith('/api/notifications/n1/read', expect.anything()),
    );
  });

  it('reports a failed load instead of rendering a quiet inbox', () => {
    render(<Notifications feed={{ items: [], unread: 0, total: 0, facets: { tones: { bad: 0, warn: 0, good: 0, info: 0 }, unread: 0, read: 0 } }} loadError="Backend unreachable" />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/could not load your notifications/i)).toBeInTheDocument();
    expect(screen.queryByText(/nothing yet/i)).not.toBeInTheDocument();
  });

  it('keeps the last good page under a failed refetch', async () => {
    apiCall.mockResolvedValue(fail('Backend unreachable'));
    render(<Notifications feed={feed()} />);

    fireEvent.click(statusChip(/^Unread/));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    // The rows that were on screen stay: an outage must not read as "no matches".
    expect(screen.getByText('Recipient signed')).toBeInTheDocument();
  });

  it('distinguishes an empty feed from a filtered-empty one', async () => {
    const empty: NotificationFeed = {
      items: [], unread: 0, total: 0,
      facets: { tones: { bad: 0, warn: 0, good: 0, info: 0 }, unread: 0, read: 0 },
    };
    apiCall.mockResolvedValue(ok(empty));
    render(<Notifications feed={empty} />);
    expect(screen.getByText(/nothing yet/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search notifications'), { target: { value: 'nope' } });
    await waitFor(() => expect(screen.getByText(/no notifications match these filters/i)).toBeInTheDocument());
  });
});
