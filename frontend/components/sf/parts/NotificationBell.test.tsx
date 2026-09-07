/**
 * The header bell.
 *
 * The tray this replaced hardcoded five invented alerts, so the properties
 * worth pinning are the ones that make the new one honest: the badge counts
 * what the server says is unread (not the rows on screen), reading a row
 * settles the badge from the server's count, and a failed feed says so rather
 * than showing an empty tray that implies nothing has happened.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { router, resetNavigation } from '@/test/navigation';
import type { NotificationFeed } from '@/lib/api/types';
import NotificationBell from './NotificationBell';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).navigationMock());

const apiCall = vi.fn();
vi.mock('@/lib/api/browser', () => ({ apiCall: (...args: unknown[]) => apiCall(...args) }));

const row = (over: Partial<NotificationFeed['items'][number]> = {}) => ({
  id: 'n1',
  title: 'Recipient signed',
  detail: 'Buyer Seller Packet — buyer@example.com signed.',
  tone: 'good' as const,
  screen: 'documents',
  target_id: 'doc-1',
  read_at: null,
  created_at: new Date().toISOString(),
  ...over,
});

const feed = (over: Partial<NotificationFeed> = {}): NotificationFeed => ({
  items: [row()],
  unread: 1,
  total: 1,
  facets: { tones: { bad: 0, warn: 0, good: 1, info: 0 }, unread: 1, read: 0 },
  ...over,
});

const ok = <T,>(data: T) => ({ ok: true as const, data });
const fail = () => ({ ok: false as const, error: { kind: 'server', status: 500, message: 'boom' } });

const bell = () => screen.getByRole('button', { name: /notifications/i });

beforeEach(() => {
  cleanup();
  resetNavigation();
  apiCall.mockReset();
});

describe('the notification bell', () => {
  it('badges the unread count from the server, not the rows on screen', () => {
    // 12 unread but only one row fetched: the badge must not say 1.
    render(<NotificationBell initial={feed({ unread: 12 })} />);
    expect(bell()).toHaveAttribute('aria-label', 'Notifications, 12 unread');
    expect(screen.getByText('9+')).toBeInTheDocument();
  });

  it('renders no badge when nothing is unread', () => {
    render(<NotificationBell initial={feed({ items: [row({ read_at: new Date().toISOString() })], unread: 0 })} />);
    expect(bell()).toHaveAttribute('aria-label', 'Notifications');
    expect(screen.queryByText('1')).not.toBeInTheDocument();
  });

  it('is a bell with no tray until it is opened', () => {
    render(<NotificationBell initial={feed()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(apiCall).not.toHaveBeenCalled();
  });

  it('refetches on open, so a long-open page is not stale', async () => {
    apiCall.mockResolvedValue(ok(feed({ items: [row({ title: 'Document completed' })], unread: 1 })));
    render(<NotificationBell initial={feed({ items: [], unread: 0, total: 0 })} />);

    fireEvent.click(bell());
    expect(apiCall).toHaveBeenCalledWith('/api/notifications', expect.objectContaining({ query: { limit: 20 } }));
    await waitFor(() => expect(screen.getByText('Document completed')).toBeInTheDocument());
  });

  it('takes the badge from the server when a row is read', async () => {
    apiCall.mockImplementation((path: string) => {
      if (path === '/api/notifications') return Promise.resolve(ok(feed({ unread: 4 })));
      // The server knows about three more unread rows this page never fetched.
      return Promise.resolve(ok({ updated: 1, unread: 3 }));
    });
    render(<NotificationBell initial={feed({ unread: 4 })} />);
    fireEvent.click(bell());

    await waitFor(() => expect(screen.getByText('Recipient signed')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Recipient signed'));

    await waitFor(() =>
      expect(apiCall).toHaveBeenCalledWith('/api/notifications/n1/read', expect.anything()),
    );
    // 3, not 0 — reading one row does not clear a badge it did not own.
    await waitFor(() => expect(bell()).toHaveAttribute('aria-label', 'Notifications, 3 unread'));
  });

  it('follows a row to the envelope it is about', async () => {
    apiCall.mockResolvedValue(ok(feed()));
    render(<NotificationBell initial={feed()} />);
    fireEvent.click(bell());
    await waitFor(() => expect(screen.getByText('Recipient signed')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Recipient signed'));
    expect(router.push).toHaveBeenCalledWith(expect.stringContaining('doc-1'));
    // Following a row closes the tray behind it.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('routes a billing or support row to its own screen, not to an envelope', async () => {
    // The rows the seeder writes carry a plain screen key and no envelope.
    apiCall.mockResolvedValue(ok(feed({
      items: [row({ title: 'Invoice INV-2026-0841 is due in 4 days', screen: 'invoices', target_id: null, tone: 'info' })],
    })));
    render(<NotificationBell initial={feed()} />);
    fireEvent.click(bell());

    fireEvent.click(await screen.findByText(/invoice inv-2026-0841/i));
    expect(router.push).toHaveBeenCalledWith(expect.stringContaining('invoices'));
  });

  it('reads a row that leads nowhere instead of navigating', async () => {
    apiCall.mockImplementation((path: string) => {
      if (path === '/api/notifications')
        return Promise.resolve(ok(feed({ items: [row({ screen: 'not-a-screen', target_id: null })] })));
      return Promise.resolve(ok({ updated: 1, unread: 0 }));
    });
    render(<NotificationBell initial={feed()} />);
    fireEvent.click(bell());

    fireEvent.click(await screen.findByText('Recipient signed'));
    await waitFor(() =>
      expect(apiCall).toHaveBeenCalledWith('/api/notifications/n1/read', expect.anything()),
    );
    expect(router.push).not.toHaveBeenCalled();
  });

  it('clears every unread row with "Mark all read"', async () => {
    apiCall.mockImplementation((path: string) => {
      if (path === '/api/notifications') return Promise.resolve(ok(feed({ unread: 2 })));
      return Promise.resolve(ok({ updated: 2, unread: 0 }));
    });
    render(<NotificationBell initial={feed({ unread: 2 })} />);
    fireEvent.click(bell());

    fireEvent.click(await screen.findByText('Mark all read'));
    await waitFor(() =>
      expect(apiCall).toHaveBeenCalledWith('/api/notifications/read-all', expect.anything()),
    );
    await waitFor(() => expect(bell()).toHaveAttribute('aria-label', 'Notifications'));
  });

  it('says the feed is unavailable rather than showing an empty tray', async () => {
    apiCall.mockResolvedValue(fail());
    render(<NotificationBell initial={feed()} />);
    fireEvent.click(bell());

    await waitFor(() =>
      expect(screen.getByText(/notifications are unavailable/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/nothing yet/i)).not.toBeInTheDocument();
  });

  it('distinguishes an empty feed from a broken one', async () => {
    apiCall.mockResolvedValue(ok(feed({ items: [], unread: 0, total: 0 })));
    render(<NotificationBell initial={feed({ items: [], unread: 0, total: 0 })} />);
    fireEvent.click(bell());

    await waitFor(() => expect(screen.getByText(/nothing yet/i)).toBeInTheDocument());
  });

  it('closes on Escape and on a click outside', async () => {
    apiCall.mockResolvedValue(ok(feed()));
    render(<NotificationBell initial={feed()} />);

    fireEvent.click(bell());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    fireEvent.click(bell());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
