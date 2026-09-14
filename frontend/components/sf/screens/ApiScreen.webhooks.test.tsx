/**
 * The developer screen's webhooks panel.
 *
 * The backend has always implemented the whole surface — delivery log, replay,
 * rotate-secret, per-event subscriptions — and the UI reached none of it, so a
 * failing endpoint was undebuggable from the product (AUDIT_REPORT.md §217).
 * What is pinned here is the part that is easy to get subtly wrong:
 *
 *  - the delivery log is *re-queried* per status filter, not narrowed locally;
 *  - replay is offered only for deliveries that failed (replaying a success
 *    duplicates it) and is addressed by delivery id, not nested under the
 *    endpoint;
 *  - the error and status code the backend recorded are actually shown;
 *  - `event_types: null` is the wildcard, so "All events" is a real state and
 *    un-ticking the last event falls back to it rather than muting silently;
 *  - a rotated secret is displayed once, and rotation is behind a confirm.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SFProvider } from '@/lib/sf/state';
import { DialogProvider } from '@/components/sf/DialogProvider';
import { resetNavigation, setSearchParams } from '@/test/navigation';
import type { WebhookDeliveryResponse, WebhookEndpointResponse } from '@/lib/api/types';
import ApiScreen from './ApiScreen';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).navigationMock());
vi.mock('@/components/sf/SessionProvider', () => ({
  useOptionalSession: () => null,
  default: ({ children }: { children: React.ReactNode }) => children,
}));

const apiCall = vi.fn();
vi.mock('@/lib/api/browser', () => ({ apiCall: (...args: unknown[]) => apiCall(...args) }));

const ok = <T,>(data: T) => ({ ok: true as const, status: 200, data });

const endpoint = (over: Partial<WebhookEndpointResponse> = {}): WebhookEndpointResponse => ({
  id: 'ep_1',
  organization_id: 'org_1',
  url: 'https://hooks.example.com/signflow',
  description: null,
  event_types: null,
  is_active: true,
  created_at: '2026-09-01T10:00:00Z',
  updated_at: '2026-09-01T10:00:00Z',
  ...over,
});

const delivery = (over: Partial<WebhookDeliveryResponse> = {}): WebhookDeliveryResponse => ({
  id: 'dl_1',
  endpoint_id: 'ep_1',
  event_id: 'ev_1',
  event_type: 'document.completed',
  document_id: 'doc_1',
  payload: null,
  attempt: 3,
  status: 'failed',
  status_code: 502,
  error: 'HTTP 502: bad gateway',
  delivered_at: null,
  next_retry_at: '2026-09-08T12:00:00Z',
  created_at: '2026-09-08T11:00:00Z',
  updated_at: '2026-09-08T11:00:00Z',
  ...over,
});

/** Endpoints, event catalogue and deliveries, with everything else a 200. */
function stub(options: {
  endpoints?: WebhookEndpointResponse[];
  deliveries?: WebhookDeliveryResponse[];
} = {}) {
  apiCall.mockImplementation(async (path: string, init: { method?: string } = {}) => {
    if (path === '/api/webhooks' && (init.method ?? 'GET') === 'GET') {
      return ok(options.endpoints ?? [endpoint()]);
    }
    if (path === '/api/webhooks/event-types') {
      return ok([
        { event_type: 'document.completed', description: 'Every recipient has signed.' },
        { event_type: 'document.declined', description: 'A recipient declined.' },
      ]);
    }
    if (path === '/api/webhooks/ep_1/deliveries') {
      return ok(options.deliveries ?? [delivery()]);
    }
    return ok({} as never);
  });
}

const renderScreen = () =>
  render(
    <SFProvider>
      <DialogProvider>
        <ApiScreen keys={[]} scopeCatalogue={[]} usage={null} apiSettings={null} embedContacts={[]} />
      </DialogProvider>
    </SFProvider>,
  );

/** Opens the endpoint's activity drawer and waits for the delivery log. */
async function openActivity() {
  renderScreen();
  fireEvent.click(await screen.findByRole('button', { name: 'Activity' }));
  await screen.findByText('Recent deliveries');
}

/** Every deliveries GET the screen made, as `[path, init]`. */
const deliveryCalls = () =>
  apiCall.mock.calls.filter(call => call[0] === '/api/webhooks/ep_1/deliveries');

beforeEach(() => {
  cleanup();
  resetNavigation();
  setSearchParams('section=webhooks');
  apiCall.mockReset();
  stub();
});

describe('the webhook delivery log', () => {
  it('shows the recorded attempt, status code and error', async () => {
    await openActivity();

    // Scoped to the delivery row: `document.completed` is also an event chip.
    const row = (await screen.findByText('HTTP 502: bad gateway')).parentElement!;
    expect(within(row).getByText('document.completed')).toBeInTheDocument();
    // The facts that make a failure diagnosable, none of which the UI could
    // previously reach.
    expect(within(row).getByText(/HTTP 502 · attempt 3/)).toBeInTheDocument();
    expect(within(row).getByText('failed')).toBeInTheDocument();
  });

  it('re-queries the server per status filter rather than narrowing locally', async () => {
    await openActivity();
    const before = deliveryCalls().length;
    expect(deliveryCalls().at(-1)?.[1].query).toEqual({ status: undefined, limit: 50 });

    fireEvent.click(screen.getByRole('button', { name: 'Dead-lettered' }));

    await waitFor(() => expect(deliveryCalls().length).toBe(before + 1));
    // `exhausted` is the backend's own status string; the chip is relabelled.
    expect(deliveryCalls().at(-1)?.[1].query).toEqual({ status: 'exhausted', limit: 50 });
  });

  it('offers replay for a failed delivery, addressed by delivery id', async () => {
    await openActivity();
    fireEvent.click(screen.getByRole('button', { name: 'Replay' }));

    await waitFor(() =>
      expect(apiCall).toHaveBeenCalledWith(
        '/api/webhooks/deliveries/dl_1/replay',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  it('never offers replay for a delivery that already succeeded', async () => {
    stub({ deliveries: [delivery({ status: 'succeeded', status_code: 200, error: null, next_retry_at: null })] });
    await openActivity();

    expect(screen.queryByRole('button', { name: 'Replay' })).not.toBeInTheDocument();
  });

  it('says so explicitly when an endpoint has no deliveries', async () => {
    stub({ deliveries: [] });
    await openActivity();

    expect(await screen.findByText(/No deliveries yet/)).toBeInTheDocument();
  });
});

describe('the event subscription', () => {
  it('treats a null event_types as the wildcard, not as nothing subscribed', async () => {
    await openActivity();

    expect(screen.getByRole('button', { name: 'All events' })).toHaveAttribute('aria-pressed', 'true');
    // No individual event reads as subscribed while the wildcard is on.
    const chip = screen.getByTitle('A recipient declined.');
    expect(chip).toHaveAttribute('aria-pressed', 'false');
  });

  it('subscribing to one event replaces the wildcard with a list', async () => {
    await openActivity();
    fireEvent.click(screen.getByTitle('A recipient declined.'));

    await waitFor(() =>
      expect(apiCall).toHaveBeenCalledWith(
        '/api/webhooks/ep_1',
        expect.objectContaining({ method: 'PATCH', body: { event_types: ['document.declined'] } }),
      ),
    );
  });

  it('un-ticking the last event falls back to the wildcard instead of muting the endpoint', async () => {
    stub({ endpoints: [endpoint({ event_types: ['document.declined'] })] });
    await openActivity();

    const chip = screen.getByTitle('A recipient declined.');
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(chip);

    // An empty list would subscribe to nothing at all while still reading as
    // "Active" — a silent mute. Disabling the endpoint is the honest control.
    await waitFor(() =>
      expect(apiCall).toHaveBeenCalledWith(
        '/api/webhooks/ep_1',
        expect.objectContaining({ method: 'PATCH', body: { event_types: null } }),
      ),
    );
  });
});

describe('rotating the signing secret', () => {
  it('confirms first, then shows the new secret once', async () => {
    apiCall.mockImplementation(async (path: string, init: { method?: string } = {}) => {
      if (path === '/api/webhooks' && (init.method ?? 'GET') === 'GET') return ok([endpoint()]);
      if (path === '/api/webhooks/event-types') return ok([]);
      if (path === '/api/webhooks/ep_1/deliveries') return ok([]);
      if (path === '/api/webhooks/ep_1/rotate-secret') {
        return ok({ ...endpoint(), secret: 'whsec_rotated_value' });
      }
      return ok({} as never);
    });
    renderScreen();

    fireEvent.click(await screen.findByRole('button', { name: 'Rotate secret' }));
    // Rotation breaks every receiver still verifying with the old secret, so
    // it must not be a single unguarded click.
    expect(apiCall).not.toHaveBeenCalledWith('/api/webhooks/ep_1/rotate-secret', expect.anything());

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Rotate secret/ }));

    expect(await screen.findByText('whsec_rotated_value')).toBeInTheDocument();
    expect(screen.getByText(/New signing secret for/)).toBeInTheDocument();
  });
});
