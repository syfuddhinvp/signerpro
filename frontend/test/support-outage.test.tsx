/**
 * The tenant `/support` route must not render an outage as an empty workspace.
 *
 * The page substitutes `EMPTY_PAGE` when the ticket load fails. On its own
 * that is fine -- the screen needs *something* to render -- but with no notice
 * beside it the reader is told "You have no support tickets yet", a confident
 * claim about their account produced by a request that never answered. The
 * platform twin at `(app)/platform/support` already guards this; the tenant
 * route was missed, which is what these tests pin down.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).navigationMock());

const ticketPage = vi.fn();
const stats = vi.fn();
const quickReplies = vi.fn();
const ticket = vi.fn();

vi.mock('@/lib/api/client', () => ({ serverCaller: () => vi.fn() }));
vi.mock('@/lib/api/resources', () => ({
  support: { ticketPage, stats, quickReplies, ticket },
}));

/** The screen itself is not under test here; the outage notice is. */
vi.mock('@/components/sf/screens/Support', () => ({
  default: ({ page }: { page: { items: unknown[] } }) => (
    <div data-testid="support-screen">{page.items.length} tickets</div>
  ),
}));

import Page from '@/app/(app)/support/page';

const outage = { ok: false as const, error: { kind: 'network', status: 0, message: 'Failed to fetch' } };
const emptyOk = {
  ok: true as const,
  data: { items: [], total: 0, counts: { all: 0, open: 0, pending: 0, escalated: 0, resolved: 0 } },
};

beforeEach(() => {
  vi.clearAllMocks();
  quickReplies.mockResolvedValue({ ok: true, data: [] });
  ticket.mockResolvedValue({ ok: true, data: null });
});

async function renderPage() {
  render(await Page());
}

describe('/support during a backend outage', () => {
  it('says the API is unreachable instead of claiming zero tickets', async () => {
    ticketPage.mockResolvedValue(outage);
    stats.mockResolvedValue(outage);

    await renderPage();

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/can.?t reach the signforge api/i);
    expect(alert).toHaveTextContent(/not a measurement/i);
  });

  it('surfaces the underlying error so the reader knows it was the network', async () => {
    ticketPage.mockResolvedValue(outage);
    stats.mockResolvedValue(emptyOk);

    await renderPage();

    expect(screen.getByRole('alert')).toHaveTextContent(/failed to fetch/i);
  });

  it('warns when only the stats call fails, not just the ticket list', async () => {
    ticketPage.mockResolvedValue(emptyOk);
    stats.mockResolvedValue(outage);

    await renderPage();

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('stays silent when both calls succeed — a real empty workspace is not an error', async () => {
    ticketPage.mockResolvedValue(emptyOk);
    stats.mockResolvedValue({ ok: true, data: {} });

    await renderPage();

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByTestId('support-screen')).toHaveTextContent('0 tickets');
  });
});
