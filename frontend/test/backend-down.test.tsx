/**
 * Backend-down degradation.
 *
 * `msw` fails every `/api/*` call at the transport, which is the shape of a
 * real outage: the browser's fetch rejects, nothing is thrown, and the UI has
 * to choose between saying so and rendering a confident empty state. The audit
 * found the second — "0 documents, $0 MRR, 100% uptime" — which is
 * indistinguishable from a healthy but empty workspace.
 */

import React from 'react';
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { render, screen, waitFor } from '@testing-library/react';
import { SFProvider } from '@/lib/sf/state';
import { apiCall } from '@/lib/api/browser';
import Logs from '@/components/sf/screens/Logs';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).navigationMock());

/** Every API call fails at the network layer, as it does when nothing answers. */
const server = setupServer(
  http.all('http://localhost:3000/api/*', () => HttpResponse.error()),
  http.all('/api/*', () => HttpResponse.error()),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('the transport reports an outage as one', () => {
  it('a dead backend is kind:network, not an empty success', async () => {
    const result = await apiCall('/api/documents/library');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.kind).toBe('network');
    expect(result.error.status).toBe(0);
  });

  it('the message names the API rather than blaming the user', async () => {
    const result = await apiCall('/api/organizations/me/overview');
    if (result.ok) throw new Error('unreachable');
    expect(result.error.message).toMatch(/signforge api|failed to fetch|fetch failed/i);
  });

  it('a 500 is told apart from an outage — one is retryable, the other is not', async () => {
    server.use(http.all('http://localhost:3000/api/*', () =>
      HttpResponse.json({ detail: 'Internal Server Error' }, { status: 500 })));
    const result = await apiCall('/api/documents/library');
    if (result.ok) throw new Error('unreachable');
    expect(result.error.kind).toBe('server');
    expect(result.error.status).toBe(500);
  });
});

/**
 * `Logs` used to do `setLogPage(res.ok ? res.data : EMPTY_PAGE)`: a failed
 * refetch was rendered as a workspace with zero log entries, and the same
 * pattern on the overview, revenue and platform-health tiles turned a backend
 * outage into "0 documents · $0 MRR · 100% uptime".
 *
 * It now keeps the last good page and surfaces the `ApiError` (which the
 * transport already returns correctly) as an explicit "can't reach the API"
 * affordance with a retry.
 */
describe('screens degrade honestly when the API is unreachable', () => {
  it('Logs says it cannot reach the API instead of showing zero rows', async () => {
    render(
      <SFProvider>
        <Logs
          {...({
            page: { items: [], total: 0, sources: [], levels: [] },
            scope: 'tenant', sinceDays: 30, orgSlug: 'acme',
          } as unknown as React.ComponentProps<typeof Logs>)}
        />
      </SFProvider>,
    );
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/can.?t reach|unreachable/i));
    expect(screen.getByRole('button', { name: /retry|try again/i })).toBeInTheDocument();
  });
});
